import { createHash } from "node:crypto";
import {
  detectLyricLanguage,
  languageMatchesSource,
  type LyricLanguage,
} from "@/lib/lyric-language";
import {
  buildSearchQueryChunks,
  getSearchableLines,
  type AuditWebEvidence,
} from "@/lib/source-audit";
import type { SourceReport } from "@/lib/source-detector";
import {
  listAuditSources,
  listAuditRuns,
  listProviderSettings,
  type AuditSource,
  type AuditRun,
  type ProviderSetting,
  type SiteProfile,
} from "@/lib/training-store";

type ProviderSearchContext = {
  auditSources: AuditSource[];
  detectedLanguage: LyricLanguage;
  heuristic: SourceReport;
  siteProfiles: SiteProfile[];
  text: string;
};

type ProviderSearchResult = {
  evidence: AuditWebEvidence[];
  notes: string;
  queries: string[];
};

type WebEvidenceCollection = {
  fallbackChain: string[];
  fromCache: boolean;
  inputHash: string;
  notes: string;
  providerId: string | null;
  queries: string[];
  searchResultCount: number;
  status: "success" | "fallback" | "heuristic" | "error";
  webEvidence: AuditWebEvidence[];
};

type SearchProvider = {
  search: (
    setting: ProviderSetting,
    context: ProviderSearchContext,
  ) => Promise<ProviderSearchResult>;
};

const defaultGeminiSearchModel =
  process.env.GEMINI_SEARCH_MODEL ?? "gemini-2.5-flash";
const geminiApiBaseUrl =
  "https://generativelanguage.googleapis.com/v1beta/models";
const tavilySearchUrl = "https://api.tavily.com/search";
const cachedAuditMaxAgeMs = 1000 * 60 * 60 * 24;

const providers: Record<string, SearchProvider> = {
  "gemini-search": {
    search: searchWithGemini,
  },
  tavily: {
    search: searchWithTavily,
  },
};

function hashInput(text: string) {
  const normalized = text.replace(/\r\n?/g, "\n").trim();
  return createHash("sha256").update(normalized).digest("hex");
}

function safeDomainFromUrl(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function matchesLowConfidenceMode(
  setting: ProviderSetting,
  heuristic: SourceReport,
) {
  if (setting.mode !== "low-confidence-only") {
    return true;
  }

  return heuristic.suspicion === "low";
}

function isUnderDailySoftLimit(
  setting: ProviderSetting,
  auditRuns: AuditRun[],
  now: number,
) {
  if (setting.dailySoftLimit <= 0) {
    return true;
  }

  const windowStart = now - 1000 * 60 * 60 * 24;
  const recentRuns = auditRuns.filter((run) => {
    if (run.providerId !== setting.providerId) {
      return false;
    }

    const createdAt = Date.parse(run.createdAt);
    return Number.isFinite(createdAt) && createdAt >= windowStart;
  });

  return recentRuns.length < setting.dailySoftLimit;
}

function getCachedAuditRun(inputHash: string, auditRuns: AuditRun[]) {
  const now = Date.now();

  return auditRuns.find((run) => {
    if (run.inputHash !== inputHash || run.webEvidence.length === 0) {
      return false;
    }

    const createdAt = Date.parse(run.createdAt);

    if (!Number.isFinite(createdAt)) {
      return false;
    }

    return now - createdAt <= cachedAuditMaxAgeMs;
  });
}

function getMatchingDomains(
  text: string,
  heuristic: SourceReport,
  siteProfiles: SiteProfile[],
  auditSources: AuditSource[],
  detectedLanguage: LyricLanguage,
) {
  const lowered = text.toLowerCase();
  const sourceDomains = auditSources
    .filter(
      (source) =>
        source.enabled && languageMatchesSource(detectedLanguage, source.language),
    )
    .map((source) => source.domain);
  const profileMatches = siteProfiles
    .filter((profile) => {
      if (lowered.includes(profile.domain.toLowerCase())) {
        return true;
      }

      if (lowered.includes(profile.name.toLowerCase())) {
        return true;
      }

      return profile.fingerprints.some((fingerprint) =>
        lowered.includes(fingerprint.toLowerCase()),
      );
    })
    .map((profile) => profile.domain);

  return [
    ...new Set([
      ...sourceDomains,
      ...heuristic.candidates.map((item) => item.domain),
      ...profileMatches,
    ]),
  ];
}

function buildQueries(
  text: string,
  heuristic: SourceReport,
  siteProfiles: SiteProfile[],
  auditSources: AuditSource[],
  detectedLanguage: LyricLanguage,
) {
  const lines = getSearchableLines(text);
  const queryChunks = buildSearchQueryChunks(text, {
    maxChunkChars: 110,
    maxChunks: 3,
  });
  const fingerprintQuery = queryChunks.map((chunk) => `"${chunk}"`).join(" ");
  const primaryLine = lines[0];
  const matchingDomains = getMatchingDomains(
    text,
    heuristic,
    siteProfiles,
    auditSources,
    detectedLanguage,
  );
  const queries: string[] = [];

  for (const domain of matchingDomains) {
    if (fingerprintQuery) {
      queries.push(`site:${domain} ${fingerprintQuery}`);
    }
  }

  if (fingerprintQuery) {
    queries.push(`${fingerprintQuery} lyrics`);
  }

  for (const domain of matchingDomains) {
    if (primaryLine) {
      queries.push(`site:${domain} "${primaryLine}"`);
    }
  }

  if (primaryLine) {
    queries.push(`"${primaryLine}" lyrics`);
  }

  return [...new Set(queries)].filter(Boolean);
}

function extractGeminiText(candidate: {
  content?: {
    parts?: Array<{
      text?: string;
    }>;
  };
}) {
  return (
    candidate.content?.parts
      ?.map((part) => part.text?.trim())
      .filter((value): value is string => Boolean(value))
      .join("\n") ?? ""
  );
}

function buildGeminiEvidence(
  providerId: string,
  candidate: {
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
    groundingMetadata?: {
      groundingChunks?: Array<{
        web?: {
          title?: string;
          uri?: string;
        };
      }>;
      groundingSupports?: Array<{
        groundingChunkIndices?: number[];
        segment?: {
          text?: string;
        };
      }>;
      webSearchQueries?: string[];
    };
  },
) {
  const answerText = extractGeminiText(candidate);
  const chunks = candidate.groundingMetadata?.groundingChunks ?? [];
  const supports = candidate.groundingMetadata?.groundingSupports ?? [];
  const evidence: Array<AuditWebEvidence | null> = chunks.map((chunk, index) => {
    const web = chunk.web;

    if (!web?.uri || !web.title) {
      return null;
    }

    const snippet =
      supports
        .filter((support) =>
          support.groundingChunkIndices?.includes(index),
        )
        .map((support) => support.segment?.text?.trim())
        .filter((value): value is string => Boolean(value))
        .join(" ")
        .slice(0, 400) || answerText.slice(0, 400);

    return {
      providerId,
      score: null,
      snippet,
      title: web.title,
      url: web.uri,
    };
  });

  return evidence.filter((item): item is AuditWebEvidence => item !== null);
}

async function runTavilyQuery(query: string, timeoutMs: number) {
  const apiKey = process.env.TAVILY_API_KEY;

  if (!apiKey) {
    throw new Error("Missing TAVILY_API_KEY");
  }

  const response = await fetch(tavilySearchUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      exact_match: true,
      max_results: 5,
      query,
      search_depth: "basic",
      topic: "general",
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    throw new Error(`Tavily search failed with status ${response.status}`);
  }

  return (await response.json()) as {
    results?: Array<{
      content?: string;
      score?: number | null;
      title?: string;
      url?: string;
    }>;
  };
}

async function searchWithTavily(
  setting: ProviderSetting,
  context: ProviderSearchContext,
): Promise<ProviderSearchResult> {
  const queries = buildQueries(
    context.text,
    context.heuristic,
    context.siteProfiles,
    context.auditSources,
    context.detectedLanguage,
  );

  if (queries.length === 0) {
    return {
      evidence: [],
      notes: "No searchable lyric lines were available for Tavily.",
      queries: [],
    };
  }

  const collectedEvidence: AuditWebEvidence[] = [];
  const attemptedQueries: string[] = [];
  const seenUrls = new Set<string>();

  for (const query of queries) {
    attemptedQueries.push(query);
    const payload = await runTavilyQuery(query, setting.timeoutMs);
    const nextEvidence = (payload.results ?? [])
      .filter((result) => Boolean(result.url && result.title && result.content))
      .map((result) => ({
        providerId: setting.providerId,
        score: result.score ?? null,
        snippet: result.content ?? "",
        title: result.title ?? "Untitled result",
        url: result.url ?? "",
      }))
      .filter((result) => {
        if (seenUrls.has(result.url)) {
          return false;
        }

        seenUrls.add(result.url);
        return true;
      });

    collectedEvidence.push(...nextEvidence);

  }

  return {
    evidence: collectedEvidence.slice(0, 10),
    notes:
      collectedEvidence.length > 0
        ? `Tavily returned ${collectedEvidence.length} matching search result${collectedEvidence.length === 1 ? "" : "s"}.`
        : "Tavily did not return any matching web evidence for the current lyric lines.",
    queries: attemptedQueries,
  };
}

async function searchWithGemini(
  setting: ProviderSetting,
  context: ProviderSearchContext,
): Promise<ProviderSearchResult> {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error("Missing GEMINI_API_KEY");
  }

  const queries = buildQueries(
    context.text,
    context.heuristic,
    context.siteProfiles,
    context.auditSources,
    context.detectedLanguage,
  );

  if (queries.length === 0) {
    return {
      evidence: [],
      notes: "No searchable lyric lines were available for Gemini Search.",
      queries: [],
    };
  }

  const response = await fetch(
    `${geminiApiBaseUrl}/${defaultGeminiSearchModel}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: [
                  "Search the live web for the likely external source of these lyrics.",
                  `Detected lyric language: ${context.detectedLanguage}.`,
                  "Prioritize exact matches, lyric blogs, and transcription websites.",
                  "Search the configured source domains one by one before broadening out.",
                  "Use these search queries as the strongest clues:",
                  ...queries.map((query) => `- ${query}`),
                ].join("\n"),
              },
            ],
            role: "user",
          },
        ],
        generationConfig: {
          temperature: 0.1,
        },
        tools: [
          {
            google_search: {},
          },
        ],
      }),
      signal: AbortSignal.timeout(setting.timeoutMs),
    },
  );

  if (!response.ok) {
    throw new Error(`Gemini Search failed with status ${response.status}`);
  }

  const payload = (await response.json()) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          text?: string;
        }>;
      };
      groundingMetadata?: {
        groundingChunks?: Array<{
          web?: {
            title?: string;
            uri?: string;
          };
        }>;
        groundingSupports?: Array<{
          groundingChunkIndices?: number[];
          segment?: {
            text?: string;
          };
        }>;
        webSearchQueries?: string[];
      };
    }>;
  };
  const candidate = payload.candidates?.[0];

  if (!candidate) {
    return {
      evidence: [],
      notes: "Gemini Search returned no grounded candidate.",
      queries: [],
    };
  }

  const evidence = buildGeminiEvidence(setting.providerId, candidate).slice(0, 5);
  const groundedQueries =
    candidate.groundingMetadata?.webSearchQueries?.filter(Boolean) ?? [];

  return {
    evidence,
    notes:
      evidence.length > 0
        ? `Gemini Search grounded the audit against ${evidence.length} Google-backed web result${evidence.length === 1 ? "" : "s"}.`
        : "Gemini Search ran, but it did not return grounded web results for these lyric lines.",
    queries: groundedQueries,
  };
}

export async function collectWebEvidence(
  text: string,
  heuristic: SourceReport,
  siteProfiles: SiteProfile[],
): Promise<WebEvidenceCollection> {
  const inputHash = hashInput(text);
  const detectedLanguage = detectLyricLanguage(text);
  const [providerSettings, auditRuns, auditSources] = await Promise.all([
    listProviderSettings(),
    listAuditRuns(),
    listAuditSources(),
  ]);
  const cachedRun = getCachedAuditRun(inputHash, auditRuns);

  if (cachedRun) {
    return {
      fallbackChain: cachedRun.fallbackChain,
      fromCache: true,
      inputHash,
      notes:
        cachedRun.notes || "Reused cached web evidence from a recent matching audit.",
      providerId: cachedRun.providerId,
      queries: cachedRun.queries,
      searchResultCount: cachedRun.searchResultCount,
      status: cachedRun.status === "error" ? "error" : "success",
      webEvidence: cachedRun.webEvidence,
    };
  }

  const now = Date.now();
  const attemptedProviders: string[] = [];
  const attemptedQueries: string[] = [];
  const languageSourceCount = auditSources.filter(
    (source) =>
      source.enabled && languageMatchesSource(detectedLanguage, source.language),
  ).length;
  const notes: string[] = [
    `Detected lyric language: ${detectedLanguage}.`,
    `Configured sources checked for this language: ${languageSourceCount}.`,
  ];

  for (const setting of providerSettings) {
    if (!setting.enabled) {
      continue;
    }

    if (!matchesLowConfidenceMode(setting, heuristic)) {
      notes.push(`${setting.name} skipped because it is only enabled for low-confidence audits.`);
      continue;
    }

    if (!isUnderDailySoftLimit(setting, auditRuns, now)) {
      attemptedProviders.push(setting.providerId);
      notes.push(`${setting.name} skipped because it reached the daily soft limit.`);

      if (!setting.allowFallback) {
        break;
      }

      continue;
    }

    attemptedProviders.push(setting.providerId);
    const provider = providers[setting.providerId];

    if (!provider) {
      notes.push(`${setting.name} is configured but not implemented in the audit router yet.`);

      if (!setting.allowFallback) {
        break;
      }

      continue;
    }

    try {
      const result = await provider.search(setting, {
        auditSources,
        detectedLanguage,
        heuristic,
        siteProfiles,
        text,
      });

      attemptedQueries.push(...result.queries);

      if (result.evidence.length > 0) {
        return {
          fallbackChain: attemptedProviders,
          fromCache: false,
          inputHash,
          notes: [...notes, result.notes].join(" "),
          providerId: setting.providerId,
          queries: attemptedQueries,
          searchResultCount: result.evidence.length,
          status: attemptedProviders.length > 1 ? "fallback" : "success",
          webEvidence: result.evidence,
        };
      }

      notes.push(result.notes);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown provider failure";
      notes.push(`${setting.name} failed: ${message}.`);
    }

    if (!setting.allowFallback) {
      break;
    }
  }

  return {
    fallbackChain: attemptedProviders,
    fromCache: false,
    inputHash,
    notes:
      notes.join(" ") ||
      "No enabled provider returned usable web evidence for this audit.",
    providerId: null,
    queries: attemptedQueries,
    searchResultCount: 0,
    status: attemptedProviders.length > 0 ? "error" : "heuristic",
    webEvidence: [],
  };
}

export function getLikelyDomainFromEvidence(webEvidence: AuditWebEvidence[]) {
  const domains = webEvidence
    .map((item) => safeDomainFromUrl(item.url))
    .filter((value): value is string => Boolean(value));

  return domains[0] ?? null;
}
