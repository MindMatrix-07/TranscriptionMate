import { NextResponse } from "next/server";
import { appendFeedback } from "@/lib/training-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      auditRunId?: string | null;
      auditSummary?: string;
      inputExcerpt?: string;
      likelySourceDomain?: string | null;
      likelySourceName?: string | null;
      providerId?: string | null;
      spamProbability?: number;
      verdict?: "yes" | "no";
    };

    if (!body.verdict || !body.inputExcerpt) {
      return NextResponse.json(
        { error: "Feedback payload is incomplete." },
        { status: 400 },
      );
    }

    const feedback = await appendFeedback({
      auditRunId: body.auditRunId ?? null,
      auditSummary: body.auditSummary ?? "",
      inputExcerpt: body.inputExcerpt.slice(0, 600),
      likelySourceDomain: body.likelySourceDomain ?? null,
      likelySourceName: body.likelySourceName ?? null,
      providerId: body.providerId ?? null,
      spamProbability: Number(body.spamProbability ?? 0),
      verdict: body.verdict,
    });

    return NextResponse.json({ feedback });
  } catch {
    return NextResponse.json(
      { error: "Failed to record feedback." },
      { status: 500 },
    );
  }
}
