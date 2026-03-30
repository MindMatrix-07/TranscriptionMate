import { NextResponse } from "next/server";
import { buildManualSearchLinks, type SourceAuditResult } from "@/lib/source-audit";
import { rateLimitAudit } from "@/lib/rate-limit";
import { detectSource } from "@/lib/source-detector";
import {
  listFeedback,
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

function buildFallbackAudit(text: string) {
  const heuristic = detectSource(text);
  const topCandidate = heuristic.candidates[0];

  return {
    aiArtifacts: [],
    confidence:
      heuristic.suspicion === "high"
        ? "high"
        : heuristic.suspicion === "medium"
          ? "medium"
          : "low",
    heuristic,
    indicators: topCandidate?.evidence.map((item) => item.clue) ?? [],
    likelySourceDomain: topCandidate?.domain ?? null,
    likelySourceName: topCandidate?.name ?? null,
    manualSearches: buildManualSearchLinks(text, topCandidate?.domain ?? null),
    mode: "heuristic",
    providerConfigured: false,
    rationale: heuristic.summary,
    recommendedAction:
      topCandidate || heuristic.flags.length > 0
        ? "Manually verify the top lyric line before accepting this submission."
        : "No strong external-source clues were found, but a manual spot-check is still wise for public submissions.",
    spamProbability:
      heuristic.suspicion === "high"
        ? 90
        : heuristic.suspicion === "medium"
          ? 60
          : 20,
  } satisfies SourceAuditResult;
}

async function requestAiAudit(text: string) {
  const heuristic = detectSource(text);
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return buildFallbackAudit(text);
  }

  const [siteProfiles, trainingNotes, feedback] = await Promise.all([
    listSiteProfiles(),
    listTrainingNotes(),
    listFeedback(),
  ]);

  const promptPayload = {
    feedbackLearnings: feedback
      .filter((item) => item.verdict === "no")
      .slice(0, 15)
      .map((item) => ({
        auditSummary: item.auditSummary,
        likelySourceDomain: item.likelySourceDomain,
        likelySourceName: item.likelySourceName,
        spamProbability: item.spamProbability,
      })),
    heuristicSummary: heuristic.summary,
    heuristicCandidates: heuristic.candidates.map((candidate) => ({
      domain: candidate.domain,
      evidence: candidate.evidence.map((item) => item.clue),
      name: candidate.name,
      score: candidate.score,
    })),
    heuristicFlags: heuristic.flags,
    lyrics: text,
    siteProfiles: siteProfiles.slice(0, 30).map((profile) => ({
      domain: profile.domain,
      fingerprints: profile.fingerprints,
      name: profile.name,
      notes: profile.notes,
      searchHint: profile.searchHint,
    })),
    trainingNotes: trainingNotes.slice(-20).map((note) => ({
      author: note.author,
      content: note.content,
    })),
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
            'You are a forensic lyrics moderation assistant. Analyze pasted lyrics for copy-paste source fingerprints and likely external origins. Use the supplied site profiles, admin training notes, and past incorrect-feedback examples as learned context. Focus on metadata artifacts, site-brand clues, footer remnants, translation labels, digital signatures, and AI-draft language. Be conservative: if the evidence is weak, say so. Output only JSON that matches the provided schema.',
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
    "heuristic" | "manualSearches" | "mode" | "providerConfigured"
  >;

  return {
    ...parsed,
    heuristic,
    manualSearches: buildManualSearchLinks(
      text,
      parsed.likelySourceDomain ?? heuristic.candidates[0]?.domain ?? null,
    ),
    mode: "ai",
    providerConfigured: true,
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

    let audit: SourceAuditResult;

    try {
      audit = await requestAiAudit(text);
    } catch {
      audit = buildFallbackAudit(text);
    }

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
