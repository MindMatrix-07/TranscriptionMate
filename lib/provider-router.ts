import { createHash } from "node:crypto";
import { getSearchableLines, type AuditWebEvidence } from "@/lib/source-audit";
import type { SourceReport } from "@/lib/source-detector";
import {
  listAuditRuns,
  listProviderSettings,
  type AuditRun,
  type ProviderSetting,
  type SiteProfile,
} from "@/lib/training-store";

type ProviderSearchContext = {
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

const tavilySearchUrl = "https://api.tavily.com/search";
const cachedAuditMaxAgeMs = 1000 * 60 * 60 * 24;

const providers: Record<string, SearchProvider> = {
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
) {
  const lowered = text.toLowerCase();
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
      ...heuristic.candidates.map((item) => item.domain),
      ...profileMatches,
    ]),
  ];
}

function buildQueries(text: string, heuristic: SourceReport, siteProfiles: SiteProfile[]) {
  const lines = getSearchableLines(text);
  const primaryLine = lines[0];
  const secondaryLine = lines[1];
  const matchingDomains = getMatchingDomains(text, heuristic, siteProfiles).slice(0, 2);
  const queries: string[] = [];

  if (primaryLine && matchingDomains[0]) {
    queries.push(`site:${matchingDomains[0]} "${primaryLine}"`);
  }

  if (primaryLine && secondaryLine) {
    queries.push(`"${primaryLine}" "${secondaryLine}" lyrics`);
  } else if (primaryLine) {
    queries.push(`"${primaryLine}" lyrics`);
  }

  if (primaryLine && matchingDomains[1]) {
    queries.push(`site:${matchingDomains[1]} "${primaryLine}"`);
  }

  return [...new Set(queries)].slice(0, 3);
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
  const queries = buildQueries(context.text, context.heuristic, context.siteProfiles);

  if (queries.length === 0) {
    return {
      evidence: [],
      notes: "No searchable lyric lines were available for Tavily.",
      queries: [],
    };
  }

  const collectedEvidence: AuditWebEvidence[] = [];
  const attemptedQueries: string[] = [];

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
      }));

    collectedEvidence.push(...nextEvidence);

    if (nextEvidence.length > 0) {
      break;
    }
  }

  return {
    evidence: collectedEvidence.slice(0, 5),
    notes:
      collectedEvidence.length > 0
        ? `Tavily returned ${collectedEvidence.length} matching search result${collectedEvidence.length === 1 ? "" : "s"}.`
        : "Tavily did not return any matching web evidence for the current lyric lines.",
    queries: attemptedQueries,
  };
}

export async function collectWebEvidence(
  text: string,
  heuristic: SourceReport,
  siteProfiles: SiteProfile[],
): Promise<WebEvidenceCollection> {
  const inputHash = hashInput(text);
  const [providerSettings, auditRuns] = await Promise.all([
    listProviderSettings(),
    listAuditRuns(),
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
  const notes: string[] = [];

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
