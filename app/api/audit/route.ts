import { NextResponse } from "next/server";
import {
  compareLyricsAgainstWebEvidence,
  summarizeCandidateMatches,
} from "@/lib/audit-line-matcher";
import {
  buildManualSearchLinks,
  type SourceAuditResult,
} from "@/lib/source-audit";
import {
  collectWebEvidence,
  getLikelyDomainFromEvidence,
} from "@/lib/provider-router";
import { rateLimitAudit } from "@/lib/rate-limit";
import { detectSource } from "@/lib/source-detector";
import {
  appendAuditRun,
  listFeedback,
  listTrainingLessons,
  listSiteProfiles,
  listTrainingNotes,
} from "@/lib/training-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const openAiApiUrl = "https://api.openai.com/v1/responses";
const defaultAuditModel = process.env.AUDIT_MODEL ?? "gpt-5-nano";
const defaultAuditLimit = Number(process.env.AUDIT_RATE_LIMIT_PER_HOUR ?? "5");
const maxInputLength = 12000;

const auditSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    spamProbability: {
      type: "integer",
      minimum: 0,
      maximum: 100,
    },
    confidence: {
      type: "string",
      enum: ["low", "medium", "high"],
    },
    likelySourceName: {
      type: ["string", "null"],
    },
    likelySourceDomain: {
      type: ["string", "null"],
    },
    indicators: {
      type: "array",
      items: {
        type: "string",
      },
    },
    aiArtifacts: {
      type: "array",
      items: {
        type: "string",
      },
    },
    rationale: {
      type: "string",
    },
    recommendedAction: {
      type: "string",
    },
  },
  required: [
    "spamProbability",
    "confidence",
    "likelySourceName",
    "likelySourceDomain",
    "indicators",
    "aiArtifacts",
    "rationale",
    "recommendedAction",
  ],
} as const;

type AuditContext = {
  candidateMatchSummary: ReturnType<typeof summarizeCandidateMatches>;
  candidateMatches: Awaited<ReturnType<typeof compareLyricsAgainstWebEvidence>>;
  feedback: Awaited<ReturnType<typeof listFeedback>>;
  heuristic: ReturnType<typeof detectSource>;
  siteProfiles: Awaited<ReturnType<typeof listSiteProfiles>>;
  trainingLessons: Awaited<ReturnType<typeof listTrainingLessons>>;
  trainingNotes: Awaited<ReturnType<typeof listTrainingNotes>>;
  webSearch: Awaited<ReturnType<typeof collectWebEvidence>>;
};

function getClientIp(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for");

  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || "unknown";
  }

  return request.headers.get("x-real-ip") ?? "unknown";
}

function extractOutputText(payload: unknown) {
  if (
    !payload ||
    typeof payload !== "object" ||
    !("output" in payload) ||
    !Array.isArray(payload.output)
  ) {
    return null;
  }

  for (const item of payload.output) {
    if (
      item &&
      typeof item === "object" &&
      "type" in item &&
      item.type === "message" &&
      "content" in item &&
      Array.isArray(item.content)
    ) {
      for (const contentItem of item.content) {
        if (
          contentItem &&
          typeof contentItem === "object" &&
          "type" in contentItem &&
          contentItem.type === "output_text" &&
          "text" in contentItem &&
          typeof contentItem.text === "string"
        ) {
          return contentItem.text;
        }
      }
    }
  }

  return null;
}

function buildFallbackAudit(text: string, context: AuditContext) {
  const topCandidate = context.heuristic.candidates[0];
  const topLineMatch = context.candidateMatchSummary.topCandidate;
  const evidenceDomain = getLikelyDomainFromEvidence(context.webSearch.webEvidence);
  const likelySourceDomain =
    topLineMatch?.domain ?? topCandidate?.domain ?? evidenceDomain;
  const likelySourceName =
    topLineMatch?.name ?? topCandidate?.name ?? evidenceDomain;
  const hasEvidence = context.webSearch.webEvidence.length > 0;
  const indicators = [
    ...(topCandidate?.evidence.map((item) => item.clue) ?? []),
    ...context.webSearch.webEvidence
      .slice(0, 2)
      .map((item) => `Web match: ${item.title}`),
  ];

  if (topLineMatch) {
    indicators.unshift(
      `Line matches: ${topLineMatch.matchedLines}/${topLineMatch.inputLineCount}`,
      `Longest block: ${topLineMatch.longestConsecutiveBlock} line${
        topLineMatch.longestConsecutiveBlock === 1 ? "" : "s"
      }`,
    );
  }

  const confidence =
    context.candidateMatchSummary.decisive
      ? "high"
      : context.heuristic.suspicion === "high"
      ? "high"
      : context.heuristic.suspicion === "medium" || hasEvidence
        ? "medium"
        : "low";
  const spamProbability =
    context.candidateMatchSummary.decisive
      ? 92
      : context.heuristic.suspicion === "high"
      ? 90
      : context.heuristic.suspicion === "medium"
        ? 60
        : hasEvidence
          ? 45
          : 20;

  return {
    aiArtifacts: [],
    confidence,
    heuristic: context.heuristic,
    indicators,
    likelySourceDomain,
    likelySourceName,
    manualSearches: buildManualSearchLinks(text, likelySourceDomain),
    mode: "heuristic",
    providerChain: context.webSearch.fallbackChain,
    providerConfigured: Boolean(process.env.OPENAI_API_KEY),
    providerId: context.webSearch.providerId,
    rationale: [
      context.candidateMatchSummary.topCandidate
        ? context.candidateMatchSummary.summary
        : null,
      hasEvidence
        ? `${context.heuristic.summary} ${context.webSearch.notes}`
        : context.heuristic.summary,
    ]
      .filter(Boolean)
      .join(" "),
    recommendedAction: context.candidateMatchSummary.topCandidate
      ? "Review the top matched site and compare the matched lines before accepting this submission."
      : hasEvidence
      ? "Review the fetched web evidence and compare the exact lyric lines before accepting this submission."
      : topCandidate || context.heuristic.flags.length > 0
        ? "Manually verify the top lyric line before accepting this submission."
        : "No strong external-source clues were found, but a manual spot-check is still wise for public submissions.",
    spamProbability,
    candidateMatches: context.candidateMatches,
    webEvidence: context.webSearch.webEvidence,
  } satisfies SourceAuditResult;
}

function buildAuditStatus(
  audit: SourceAuditResult,
  context: AuditContext,
): "success" | "fallback" | "heuristic" | "error" {
  if (audit.mode === "ai") {
    return context.webSearch.status;
  }

  if (context.webSearch.webEvidence.length > 0) {
    return context.webSearch.status === "error"
      ? "fallback"
      : context.webSearch.status;
  }

  return context.webSearch.status === "error" ? "error" : "heuristic";
}

async function requestAiAudit(text: string, context: AuditContext) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return buildFallbackAudit(text, context);
  }

  const promptPayload = {
    feedbackLearnings: context.feedback
      .filter((item) => item.verdict === "no")
      .slice(0, 15)
      .map((item) => ({
        auditSummary: item.auditSummary,
        likelySourceDomain: item.likelySourceDomain,
        likelySourceName: item.likelySourceName,
        providerId: item.providerId ?? null,
        spamProbability: item.spamProbability,
      })),
    heuristicCandidates: context.heuristic.candidates.map((candidate) => ({
      domain: candidate.domain,
      evidence: candidate.evidence.map((item) => item.clue),
      name: candidate.name,
      score: candidate.score,
    })),
    candidateMatches: context.candidateMatches.map((candidate) => ({
      comparisonSource: candidate.comparisonSource,
      domain: candidate.domain,
      exactLineMatches: candidate.exactLineMatches,
      longestConsecutiveBlock: candidate.longestConsecutiveBlock,
      matchPercentage: candidate.matchPercentage,
      matchedLines: candidate.matchedLines,
      metadataHits: candidate.metadataHits,
      name: candidate.name,
      nearLineMatches: candidate.nearLineMatches,
      nonLyricSignals: candidate.nonLyricSignals,
      sampleMatches: candidate.sampleMatches,
      score: candidate.score,
      title: candidate.title,
      url: candidate.url,
    })),
    candidateMatchSummary: context.candidateMatchSummary.summary,
    heuristicFlags: context.heuristic.flags,
    heuristicSummary: context.heuristic.summary,
    lyrics: text,
    providerChain: context.webSearch.fallbackChain,
    providerId: context.webSearch.providerId,
    siteProfiles: context.siteProfiles.slice(0, 30).map((profile) => ({
      domain: profile.domain,
      fingerprints: profile.fingerprints,
      name: profile.name,
      notes: profile.notes,
      searchHint: profile.searchHint,
    })),
    trainingLessons: context.trainingLessons.slice(0, 30).map((lesson) => ({
      confidence: lesson.confidence,
      evidenceSources: lesson.evidenceSources,
      guidance: lesson.guidance,
      providerHints: lesson.providerHints,
      relatedDomains: lesson.relatedDomains,
      sourceMessage: lesson.sourceMessage,
      title: lesson.title,
    })),
    trainingNotes: context.trainingNotes.slice(-20).map((note) => ({
      author: note.author,
      content: note.content,
    })),
    webEvidence: context.webSearch.webEvidence,
    webSearchNotes: context.webSearch.notes,
    webSearchQueries: context.webSearch.queries,
  };

  const response = await fetch(openAiApiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: defaultAuditModel,
      input: [
        {
          role: "system",
          content:
            "You are a forensic lyrics moderation assistant. Analyze pasted lyrics for copy-paste source fingerprints and likely external origins. Use the supplied site profiles, admin training notes, past incorrect-feedback examples, fetched web evidence, and candidate line-match comparisons as learned context. Prioritize exact line matches, near line matches, and long consecutive matching blocks over generic snippets. If one candidate site clearly wins on line matching, prefer that site. Be conservative when the evidence is weak. Output only JSON that matches the provided schema.",
        },
        {
          role: "user",
          content: JSON.stringify(promptPayload),
        },
      ],
      max_output_tokens: 700,
      text: {
        format: {
          type: "json_schema",
          name: "source_audit",
          strict: true,
          schema: auditSchema,
        },
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`AI audit failed with status ${response.status}`);
  }

  const payload = (await response.json()) as unknown;
  const outputText = extractOutputText(payload);

  if (!outputText) {
    throw new Error("AI audit returned no structured output");
  }

  const parsed = JSON.parse(outputText) as Omit<
    SourceAuditResult,
    | "auditRunId"
    | "heuristic"
    | "manualSearches"
    | "mode"
    | "providerChain"
    | "providerConfigured"
    | "providerId"
    | "webEvidence"
  >;
  const likelySourceDomain =
    parsed.likelySourceDomain ??
    context.candidateMatchSummary.topCandidate?.domain ??
    context.heuristic.candidates[0]?.domain ??
    getLikelyDomainFromEvidence(context.webSearch.webEvidence);

  const baseAudit = {
    ...parsed,
    heuristic: context.heuristic,
    likelySourceDomain,
    likelySourceName:
      parsed.likelySourceName ?? context.candidateMatchSummary.topCandidate?.name ?? null,
    manualSearches: buildManualSearchLinks(text, likelySourceDomain),
    mode: "ai",
    providerChain: context.webSearch.fallbackChain,
    providerConfigured: true,
    providerId: context.webSearch.providerId,
    candidateMatches: context.candidateMatches,
    webEvidence: context.webSearch.webEvidence,
  } satisfies SourceAuditResult;

  if (!context.candidateMatchSummary.topCandidate) {
    return baseAudit;
  }

  const topCandidate = context.candidateMatchSummary.topCandidate;
  const boostedIndicators = [
    ...new Set([
      `Line matches: ${topCandidate.matchedLines}/${topCandidate.inputLineCount}`,
      `Longest block: ${topCandidate.longestConsecutiveBlock} line${
        topCandidate.longestConsecutiveBlock === 1 ? "" : "s"
      }`,
      ...baseAudit.indicators,
    ]),
  ];

  return {
    ...baseAudit,
    confidence: context.candidateMatchSummary.decisive
      ? "high"
      : baseAudit.confidence,
    indicators: boostedIndicators,
    likelySourceDomain: context.candidateMatchSummary.decisive
      ? topCandidate.domain
      : baseAudit.likelySourceDomain,
    likelySourceName: context.candidateMatchSummary.decisive
      ? topCandidate.name
      : baseAudit.likelySourceName,
    rationale: `${context.candidateMatchSummary.summary} ${baseAudit.rationale}`.trim(),
    spamProbability: context.candidateMatchSummary.decisive
      ? Math.max(baseAudit.spamProbability, 88)
      : baseAudit.spamProbability,
  } satisfies SourceAuditResult;
}

export async function POST(request: Request) {
  try {
    const ip = getClientIp(request);
    const rateLimit = await rateLimitAudit(ip, defaultAuditLimit);

    if (!rateLimit.success) {
      return NextResponse.json(
        {
          error: "Rate limit exceeded. Please try again later.",
          rateLimit,
        },
        {
          status: 429,
          headers: {
            "X-RateLimit-Limit": String(rateLimit.limit),
            "X-RateLimit-Remaining": String(rateLimit.remaining),
            "X-RateLimit-Reset": String(rateLimit.resetInSeconds),
          },
        },
      );
    }

    const body = (await request.json()) as { text?: string };
    const text = body.text?.trim() ?? "";

    if (!text) {
      return NextResponse.json(
        { error: "Lyrics text is required." },
        { status: 400 },
      );
    }

    if (text.length > maxInputLength) {
      return NextResponse.json(
        {
          error: `Lyrics input is too long. Keep it under ${maxInputLength} characters for source audits.`,
        },
        { status: 400 },
      );
    }

    const heuristic = detectSource(text);
    const [siteProfiles, trainingNotes, trainingLessons, feedback] = await Promise.all([
      listSiteProfiles(),
      listTrainingNotes(),
      listTrainingLessons(),
      listFeedback(),
    ]);
    const webSearch = await collectWebEvidence(text, heuristic, siteProfiles);
    const candidateMatches = await compareLyricsAgainstWebEvidence(
      text,
      webSearch.webEvidence,
      siteProfiles,
    );
    const context: AuditContext = {
      candidateMatchSummary: summarizeCandidateMatches(candidateMatches),
      candidateMatches,
      feedback,
      heuristic,
      siteProfiles,
      trainingLessons,
      trainingNotes,
      webSearch,
    };

    let audit: SourceAuditResult;

    try {
      audit = await requestAiAudit(text, context);
    } catch {
      audit = buildFallbackAudit(text, context);
    }

    const auditRun = await appendAuditRun({
      fallbackChain: context.webSearch.fallbackChain,
      inputHash: context.webSearch.inputHash,
      likelySourceDomain: audit.likelySourceDomain,
      likelySourceName: audit.likelySourceName,
      notes: `${context.webSearch.notes} ${audit.rationale}`.trim(),
      providerId: context.webSearch.providerId,
      queries: context.webSearch.queries,
      searchResultCount: context.webSearch.searchResultCount,
      spamProbability: audit.spamProbability,
      status: buildAuditStatus(audit, context),
      webEvidence: context.webSearch.webEvidence,
    });

    audit = {
      ...audit,
      auditRunId: auditRun.id,
    };

    return NextResponse.json(
      {
        audit,
        rateLimit,
      },
      {
        headers: {
          "X-RateLimit-Limit": String(rateLimit.limit),
          "X-RateLimit-Remaining": String(rateLimit.remaining),
          "X-RateLimit-Reset": String(rateLimit.resetInSeconds),
        },
      },
    );
  } catch {
    return NextResponse.json(
      { error: "Audit failed. Please try again." },
      { status: 500 },
    );
  }
}
