"use client";

import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpenText,
  CircleAlert,
  Check,
  Copy,
  FileText,
  MoonStar,
  Sparkles,
  SunMedium,
  WandSparkles,
} from "lucide-react";
import { sanitizeLyrics } from "@/lib/sanitize-lyrics";

type Theme = "light" | "dark";

type ToastState = {
  message: string;
  tone: "success" | "error";
} | null;

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

  const handleLoadExample = () => {
    setInput(demoLyrics);
    setOutput("");
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
                onClick={() => {
                  setInput("");
                  setOutput("");
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
