"use client";

import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BadgeAlert,
  BookOpenText,
  Bot,
  CircleAlert,
  Check,
  Copy,
  ExternalLink,
  FileText,
  LoaderCircle,
  ShieldAlert,
  MoonStar,
  SearchCheck,
  Sparkles,
  SunMedium,
  WandSparkles,
} from "lucide-react";
import type { SourceAuditResult } from "@/lib/source-audit";
import { sanitizeLyrics } from "@/lib/sanitize-lyrics";
import { detectSource, type SourceReport } from "@/lib/source-detector";

type Theme = "light" | "dark";

type ToastState = {
  message: string;
  tone: "success" | "error";
} | null;

type AuditResponse = {
  audit: SourceAuditResult;
  rateLimit: {
    limit: number;
    remaining: number;
    resetInSeconds: number;
  };
};

const demoLyrics = `  [verse 1]
I   got a pocket full of stars ,
and a little bit of midnight.   


chorus
We run through the city .   
We sing till the sun comes up\u200B
`;

const formattedDemoLyrics = sanitizeLyrics(demoLyrics);

const guideSteps = [
  {
    title: "Start with raw lyrics",
    description:
      "This sample includes uneven spacing, lowercase section labels, punctuation gaps, and a hidden zero-width space.",
    preview: demoLyrics,
    label: "Raw example",
  },
  {
    title: "See what gets cleaned",
    description:
      "The sanitizer trims the text, fixes tags, removes junk spacing, and keeps stanza breaks tidy.",
    preview: formattedDemoLyrics,
    label: "Cleaned result",
  },
  {
    title: "Load the example into the editor",
    description:
      "Use this sample if you want to test the tool quickly, then replace it with your own lyrics whenever you're ready.",
    preview: demoLyrics,
    label: "Ready to try",
  },
] as const;

function getStats(value: string) {
  const characters = value.length;
  const lines = value ? value.split("\n").length : 0;

  return { characters, lines };
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "absolute";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

export function TranscriptionMate() {
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [sourceReport, setSourceReport] = useState<SourceReport | null>(null);
  const [auditResult, setAuditResult] = useState<SourceAuditResult | null>(null);
  const [auditRateLimit, setAuditRateLimit] =
    useState<AuditResponse["rateLimit"] | null>(null);
  const [isAuditing, setIsAuditing] = useState(false);
  const [theme, setTheme] = useState<Theme>("light");
  const [mounted, setMounted] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);
  const [showExampleGuide, setShowExampleGuide] = useState(false);
  const [guideStep, setGuideStep] = useState(0);

  useEffect(() => {
    const isDark = document.documentElement.classList.contains("dark");
    setTheme(isDark ? "dark" : "light");
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) {
      return;
    }

    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    window.localStorage.setItem("transcriptionmate-theme", theme);
  }, [mounted, theme]);

  useEffect(() => {
    if (!toast) {
      return;
    }

    const timeoutId = window.setTimeout(() => setToast(null), 2200);

    return () => window.clearTimeout(timeoutId);
  }, [toast]);

  const inputStats = getStats(input);
  const outputStats = getStats(output);
  const activeGuideStep = guideSteps[guideStep];
  const suspicionTone =
    sourceReport?.suspicion === "high"
      ? "text-rose-400 bg-rose-500/15"
      : sourceReport?.suspicion === "medium"
        ? "text-amber-400 bg-amber-500/15"
        : "text-emerald-400 bg-emerald-500/15";

  const handleClean = () => {
    const sanitized = sanitizeLyrics(input);
    setOutput(sanitized);
    setToast({
      message: sanitized ? "Lyrics cleaned and formatted." : "Output cleared.",
      tone: "success",
    });
  };

  const handleCopy = async () => {
    if (!output) {
      setToast({
        message: "Nothing to copy yet.",
        tone: "error",
      });
      return;
    }

    try {
      await copyText(output);
      setToast({
        message: "Copied to clipboard.",
        tone: "success",
      });
    } catch {
      setToast({
        message: "Clipboard access failed.",
        tone: "error",
      });
    }
  };

  const handleSourceCheck = () => {
    const report = detectSource(input);
    setSourceReport(report);
    setToast({
      message:
        report.suspicion === "high"
          ? "Strong source clues detected."
          : report.suspicion === "medium"
            ? "Possible source clues detected."
            : "Source check completed.",
      tone: report.suspicion === "high" ? "error" : "success",
    });
  };

  const handleAiAudit = async () => {
    if (!input.trim()) {
      setToast({
        message: "Paste lyrics before running an AI audit.",
        tone: "error",
      });
      return;
    }

    setIsAuditing(true);

    try {
      const response = await fetch("/api/audit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text: input }),
      });

      const payload = (await response.json()) as
        | AuditResponse
        | { error?: string; rateLimit?: AuditResponse["rateLimit"] };

      if (!response.ok || !("audit" in payload)) {
        const errorMessage = "error" in payload ? payload.error : undefined;

        setToast({
          message: errorMessage ?? "AI audit failed.",
          tone: "error",
        });

        if ("rateLimit" in payload && payload.rateLimit) {
          setAuditRateLimit(payload.rateLimit);
        }

        return;
      }

      setAuditResult(payload.audit);
      setSourceReport(payload.audit.heuristic);
      setAuditRateLimit(payload.rateLimit);
      setToast({
        message:
          payload.audit.mode === "ai"
            ? "AI audit completed."
            : "AI not configured, fallback audit completed.",
        tone: "success",
      });
    } catch {
      setToast({
        message: "AI audit failed.",
        tone: "error",
      });
    } finally {
      setIsAuditing(false);
    }
  };

  const handleLoadExample = () => {
    setInput(demoLyrics);
    setOutput("");
    setSourceReport(detectSource(demoLyrics));
    setAuditResult(null);
    setShowExampleGuide(false);
    setGuideStep(0);
    setToast({
      message: "Example loaded into the input editor.",
      tone: "success",
    });
  };

  return (
    <main className="relative min-h-screen overflow-hidden px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <header className="rounded-[28px] border border-[var(--border)] bg-[var(--panel)] px-5 py-4 shadow-[0_18px_60px_rgba(15,23,42,0.12)] backdrop-blur xl:px-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--panel-strong)] px-3 py-1 text-xs font-semibold tracking-[0.24em] text-[var(--muted)] uppercase">
                <Sparkles className="size-3.5 text-[var(--accent)]" />
                Lyrics Sanitizer
              </div>
              <div>
                <h1 className="text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">
                  TranscriptionMate
                </h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)] sm:text-base">
                  Clean pasted lyrics in one pass, normalize section tags, and
                  copy a polished transcript without hand-fixing every stanza.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() =>
                setTheme((currentTheme) =>
                  currentTheme === "dark" ? "light" : "dark",
                )
              }
              className="inline-flex items-center justify-center gap-2 self-start rounded-2xl border border-[var(--border)] bg-[var(--panel-strong)] px-4 py-2 text-sm font-medium text-[var(--foreground)] transition hover:-translate-y-0.5 hover:border-[var(--accent)] hover:bg-[var(--accent-soft)]"
              aria-label="Toggle theme"
            >
              {mounted && theme === "dark" ? (
                <SunMedium className="size-4" />
              ) : (
                <MoonStar className="size-4" />
              )}
              {mounted && theme === "dark" ? "Light mode" : "Dark mode"}
            </button>
          </div>
        </header>

        <section className="grid gap-6 lg:grid-cols-[1.08fr_0.92fr]">
          <div className="rounded-[28px] border border-[var(--border)] bg-[var(--panel)] p-5 shadow-[0_18px_60px_rgba(15,23,42,0.12)] backdrop-blur xl:p-6">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <FileText className="size-4 text-[var(--accent)]" />
                  Input
                </div>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  Paste raw lyrics, tags, and spacing issues here.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowExampleGuide((current) => !current);
                    setGuideStep(0);
                  }}
                  className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--panel-strong)] px-3 py-1 text-xs font-medium text-[var(--foreground)] transition hover:border-[var(--accent)] hover:bg-[var(--accent-soft)]"
                >
                  <BookOpenText className="size-3.5" />
                  {showExampleGuide ? "Hide Example" : "Example Guide"}
                </button>
                <div className="rounded-full border border-[var(--border)] bg-[var(--panel-strong)] px-3 py-1 text-xs text-[var(--muted)]">
                  {inputStats.lines} lines · {inputStats.characters} chars
                </div>
              </div>
            </div>

            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Paste raw lyrics here, or open the example guide."
              spellCheck={false}
              className="min-h-[360px] w-full rounded-[24px] border border-[var(--border)] bg-[var(--panel-strong)] px-4 py-4 font-mono text-sm leading-7 text-[var(--foreground)] outline-none transition focus:border-[var(--accent)] focus:ring-4 focus:ring-[var(--accent-soft)]"
            />

            {showExampleGuide ? (
              <div className="mt-4 rounded-[24px] border border-[var(--border)] bg-[var(--panel-strong)] p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-xs font-semibold tracking-[0.2em] text-[var(--muted)] uppercase">
                      Step {guideStep + 1} of {guideSteps.length}
                    </p>
                    <h3 className="mt-1 text-lg font-semibold">
                      {activeGuideStep.title}
                    </h3>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">
                      {activeGuideStep.description}
                    </p>
                  </div>
                  <span className="rounded-full border border-[var(--border)] px-3 py-1 text-xs text-[var(--muted)]">
                    {activeGuideStep.label}
                  </span>
                </div>

                <pre className="mt-4 overflow-x-auto rounded-2xl border border-[var(--border)] bg-black/20 px-4 py-4 font-mono text-sm leading-7 text-[var(--foreground)]">
                  <code>{activeGuideStep.preview}</code>
                </pre>

                <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setGuideStep((currentStep) =>
                          Math.max(currentStep - 1, 0),
                        )
                      }
                      disabled={guideStep === 0}
                      className="inline-flex items-center gap-2 rounded-2xl border border-[var(--border)] bg-transparent px-4 py-2 text-sm font-medium text-[var(--foreground)] transition hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <ArrowLeft className="size-4" />
                      Back
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setGuideStep((currentStep) =>
                          Math.min(currentStep + 1, guideSteps.length - 1),
                        )
                      }
                      disabled={guideStep === guideSteps.length - 1}
                      className="inline-flex items-center gap-2 rounded-2xl border border-[var(--border)] bg-transparent px-4 py-2 text-sm font-medium text-[var(--foreground)] transition hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Next
                      <ArrowRight className="size-4" />
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={handleLoadExample}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-slate-950 transition hover:-translate-y-0.5 hover:bg-[var(--accent-strong)]"
                  >
                    Use This Example
                  </button>
                </div>
              </div>
            ) : null}

            <div className="mt-4 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={handleClean}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-slate-950 transition hover:-translate-y-0.5 hover:bg-[var(--accent-strong)]"
              >
                <WandSparkles className="size-4" />
                Clean &amp; Format
              </button>
              <button
                type="button"
                onClick={handleSourceCheck}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--panel-strong)] px-5 py-3 text-sm font-medium text-[var(--foreground)] transition hover:-translate-y-0.5 hover:border-[var(--accent)] hover:bg-[var(--accent-soft)]"
              >
                <SearchCheck className="size-4" />
                Detect Source
              </button>
              <button
                type="button"
                onClick={handleAiAudit}
                disabled={isAuditing}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--panel-strong)] px-5 py-3 text-sm font-medium text-[var(--foreground)] transition hover:-translate-y-0.5 hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isAuditing ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <Bot className="size-4" />
                )}
                {isAuditing ? "Auditing..." : "AI Audit"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setInput("");
                  setOutput("");
                  setSourceReport(null);
                  setAuditResult(null);
                  setAuditRateLimit(null);
                  setToast(null);
                }}
                className="inline-flex items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--panel-strong)] px-5 py-3 text-sm font-medium text-[var(--foreground)] transition hover:-translate-y-0.5 hover:border-[var(--accent)] hover:bg-[var(--accent-soft)]"
              >
                Clear
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-6">
            <div className="rounded-[28px] border border-[var(--border)] bg-[var(--panel)] p-5 shadow-[0_18px_60px_rgba(15,23,42,0.12)] backdrop-blur xl:p-6">
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <Check className="size-4 text-[var(--success)]" />
                    Output
                  </div>
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    Sanitized lyrics appear here after processing.
                  </p>
                </div>
                <div className="rounded-full border border-[var(--border)] bg-[var(--panel-strong)] px-3 py-1 text-xs text-[var(--muted)]">
                  {outputStats.lines} lines · {outputStats.characters} chars
                </div>
              </div>

              <textarea
                value={output}
                readOnly
                placeholder="Formatted output will appear here..."
                spellCheck={false}
                className="min-h-[360px] w-full rounded-[24px] border border-[var(--border)] bg-[var(--panel-strong)] px-4 py-4 font-mono text-sm leading-7 text-[var(--foreground)] outline-none"
              />

              <button
                type="button"
                onClick={handleCopy}
                className="mt-4 inline-flex items-center justify-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--panel-strong)] px-5 py-3 text-sm font-medium text-[var(--foreground)] transition hover:-translate-y-0.5 hover:border-[var(--accent)] hover:bg-[var(--accent-soft)]"
              >
                <Copy className="size-4" />
                Copy to Clipboard
              </button>
            </div>

            <div className="rounded-[28px] border border-[var(--border)] bg-[var(--panel)] p-5 shadow-[0_18px_60px_rgba(15,23,42,0.12)] backdrop-blur xl:p-6">
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <Bot className="size-4 text-[var(--accent)]" />
                    AI Audit
                  </div>
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    Server-side only. Runs a forensic prompt and combines it with local fingerprint detection.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-[var(--border)] px-3 py-1 text-xs text-[var(--muted)]">
                    {auditResult
                      ? `${auditResult.spamProbability}% spam probability`
                      : "Not run yet"}
                  </span>
                  <span className="rounded-full border border-[var(--border)] px-3 py-1 text-xs text-[var(--muted)]">
                    {auditResult
                      ? `${auditResult.confidence} confidence`
                      : "Server-only"}
                  </span>
                </div>
              </div>

              {auditResult ? (
                <div className="space-y-4">
                  <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel-strong)] px-4 py-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="text-sm font-semibold">
                          {auditResult.likelySourceName
                            ? `Likely source: ${auditResult.likelySourceName}`
                            : "No specific source named"}
                        </p>
                        <p className="mt-1 text-sm leading-6 text-[var(--muted)]">
                          {auditResult.rationale}
                        </p>
                      </div>
                      <span className="rounded-full bg-[var(--accent-soft)] px-3 py-1 text-xs font-medium text-[var(--foreground)]">
                        {auditResult.mode === "ai" ? "AI mode" : "Fallback mode"}
                      </span>
                    </div>

                    <p className="mt-3 text-xs leading-5 text-[var(--muted)]">
                      Recommendation: {auditResult.recommendedAction}
                    </p>
                  </div>

                  {auditResult.indicators.length > 0 ? (
                    <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel-strong)] px-4 py-4">
                      <p className="text-sm font-semibold">Detected indicators</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {auditResult.indicators.map((indicator) => (
                          <span
                            key={indicator}
                            className="rounded-full bg-[var(--accent-soft)] px-3 py-1 text-xs text-[var(--foreground)]"
                          >
                            {indicator}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {auditResult.aiArtifacts.length > 0 ? (
                    <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel-strong)] px-4 py-4">
                      <p className="text-sm font-semibold">AI-draft clues</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {auditResult.aiArtifacts.map((artifact) => (
                          <span
                            key={artifact}
                            className="rounded-full bg-amber-500/15 px-3 py-1 text-xs text-amber-400"
                          >
                            {artifact}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {auditResult.manualSearches.length > 0 ? (
                    <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel-strong)] px-4 py-4">
                      <p className="text-sm font-semibold">Manual verification</p>
                      <div className="mt-3 flex flex-col gap-2">
                        {auditResult.manualSearches.map((search) => (
                          <a
                            key={search.url}
                            href={search.url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-2 rounded-2xl border border-[var(--border)] px-4 py-3 text-sm text-[var(--foreground)] transition hover:border-[var(--accent)] hover:bg-[var(--accent-soft)]"
                          >
                            <ExternalLink className="size-4" />
                            {search.label}
                          </a>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {auditRateLimit ? (
                    <p className="text-xs text-[var(--muted)]">
                      Rate limit: {auditRateLimit.remaining} of {auditRateLimit.limit} audits left this window.
                    </p>
                  ) : null}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--panel-strong)] px-4 py-8 text-sm leading-6 text-[var(--muted)]">
                  Run <span className="font-semibold text-[var(--foreground)]">AI Audit</span> to score spam probability, name likely external sources, and generate manual search links.
                </div>
              )}
            </div>

            <div className="rounded-[28px] border border-[var(--border)] bg-[var(--panel)] p-5 shadow-[0_18px_60px_rgba(15,23,42,0.12)] backdrop-blur xl:p-6">
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <ShieldAlert className="size-4 text-[var(--accent)]" />
                    Source Check
                  </div>
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    Separate from cleaning. Use it to flag likely copy-paste fingerprints and probable source sites.
                  </p>
                </div>
                <div className={`rounded-full px-3 py-1 text-xs font-medium ${suspicionTone}`}>
                  {sourceReport ? `${sourceReport.suspicion.toUpperCase()} suspicion` : "Not run yet"}
                </div>
              </div>

              {sourceReport ? (
                <div className="space-y-4">
                  <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel-strong)] px-4 py-4">
                    <p className="text-sm font-medium text-[var(--foreground)]">
                      {sourceReport.summary}
                    </p>
                    <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
                      This is a heuristic triage tool. It can point you toward likely source sites, but exact attribution still needs manual verification.
                    </p>
                  </div>

                  {sourceReport.candidates.length > 0 ? (
                    <div className="space-y-3">
                      {sourceReport.candidates.map((candidate) => (
                        <div
                          key={candidate.domain}
                          className="rounded-2xl border border-[var(--border)] bg-[var(--panel-strong)] px-4 py-4"
                        >
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                              <p className="text-sm font-semibold">{candidate.name}</p>
                              <p className="text-xs text-[var(--muted)]">{candidate.domain}</p>
                            </div>
                            <span className="rounded-full border border-[var(--border)] px-3 py-1 text-xs text-[var(--muted)]">
                              score {candidate.score}
                            </span>
                          </div>

                          <div className="mt-3 flex flex-col gap-2">
                            {candidate.evidence.map((item) => (
                              <div
                                key={`${candidate.domain}-${item.clue}-${item.excerpt}`}
                                className="rounded-xl border border-[var(--border)] bg-black/10 px-3 py-3"
                              >
                                <p className="text-sm font-medium">{item.clue}</p>
                                <p className="mt-1 font-mono text-xs text-[var(--muted)]">
                                  {item.excerpt}
                                </p>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {sourceReport.flags.length > 0 ? (
                    <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel-strong)] px-4 py-4">
                      <div className="flex items-center gap-2 text-sm font-semibold">
                        <BadgeAlert className="size-4 text-amber-400" />
                        Risk Flags
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {sourceReport.flags.map((flag) => (
                          <span
                            key={`${flag.label}-${flag.severity}`}
                            className={`rounded-full px-3 py-1 text-xs ${
                              flag.severity === "high"
                                ? "bg-rose-500/15 text-rose-400"
                                : flag.severity === "medium"
                                  ? "bg-amber-500/15 text-amber-400"
                                  : "bg-emerald-500/15 text-emerald-400"
                            }`}
                          >
                            {flag.label}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--panel-strong)] px-4 py-8 text-sm leading-6 text-[var(--muted)]">
                  Run <span className="font-semibold text-[var(--foreground)]">Detect Source</span> after pasting lyrics to surface probable site fingerprints and copy-paste warning signs.
                </div>
              )}
            </div>

            <div className="rounded-[28px] border border-[var(--border)] bg-[var(--panel)] p-5 shadow-[0_18px_60px_rgba(15,23,42,0.12)] backdrop-blur xl:p-6">
              <h2 className="text-sm font-semibold tracking-[0.2em] text-[var(--muted)] uppercase">
                Sanitizer Order
              </h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {[
                  "Trim outer whitespace",
                  "Collapse repeated spaces",
                  "Remove trailing ghosts",
                  "Strip zero-width spaces",
                  "Normalize section tags",
                  "Fix punctuation spacing",
                  "Limit empty lines",
                ].map((rule) => (
                  <div
                    key={rule}
                    className="rounded-2xl border border-[var(--border)] bg-[var(--panel-strong)] px-4 py-3 text-sm text-[var(--foreground)]"
                  >
                    {rule}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      </div>

      {toast ? (
        <div className="pointer-events-none fixed right-4 top-4 z-20 max-w-xs animate-[toast-in_220ms_ease-out] rounded-2xl border border-[var(--border)] bg-[var(--panel-strong)] px-4 py-3 shadow-[0_18px_60px_rgba(15,23,42,0.2)] backdrop-blur">
          <div className="flex items-start gap-3">
            <div
              className={`mt-0.5 rounded-full p-1 ${
                toast.tone === "success"
                  ? "bg-emerald-500/15 text-emerald-400"
                  : "bg-rose-500/15 text-rose-400"
              }`}
            >
              {toast.tone === "success" ? (
                <Check className="size-3.5" />
              ) : (
                <CircleAlert className="size-3.5" />
              )}
            </div>
            <div>
              <p className="text-sm font-medium">{toast.message}</p>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
