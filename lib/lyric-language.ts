export const supportedLyricLanguages = [
  "english",
  "latin",
  "hindi",
  "tamil",
  "telugu",
  "kannada",
  "malayalam",
  "bengali",
  "punjabi",
  "urdu",
  "mixed",
  "unknown",
] as const;

export type LyricLanguage = (typeof supportedLyricLanguages)[number];

const scriptMatchers: Array<{
  language: LyricLanguage;
  pattern: RegExp;
}> = [
  { language: "malayalam", pattern: /[\u0D00-\u0D7F]/g },
  { language: "tamil", pattern: /[\u0B80-\u0BFF]/g },
  { language: "telugu", pattern: /[\u0C00-\u0C7F]/g },
  { language: "kannada", pattern: /[\u0C80-\u0CFF]/g },
  { language: "hindi", pattern: /[\u0900-\u097F]/g },
  { language: "bengali", pattern: /[\u0980-\u09FF]/g },
  { language: "punjabi", pattern: /[\u0A00-\u0A7F]/g },
  { language: "urdu", pattern: /[\u0600-\u06FF]/g },
  { language: "latin", pattern: /[A-Za-z]/g },
];

const englishHintPattern =
  /\b(the|you|and|love|baby|heart|night|dream|with|your|for|this|that|when|what|from|into|dont|can't|im|we|they)\b/gi;

function countMatches(text: string, pattern: RegExp) {
  return text.match(pattern)?.length ?? 0;
}

export function detectLyricLanguage(text: string): LyricLanguage {
  const trimmed = text.trim();

  if (!trimmed) {
    return "unknown";
  }

  const counts = scriptMatchers
    .map((matcher) => ({
      count: countMatches(trimmed, matcher.pattern),
      language: matcher.language,
    }))
    .filter((item) => item.count > 0)
    .sort((left, right) => right.count - left.count);

  if (counts.length === 0) {
    return "unknown";
  }

  const top = counts[0];
  const second = counts[1];

  if (
    top &&
    second &&
    top.language !== second.language &&
    second.count >= Math.max(3, top.count * 0.45)
  ) {
    return "mixed";
  }

  if (!top) {
    return "unknown";
  }

  if (top.language === "latin") {
    const englishHints = countMatches(trimmed.toLowerCase(), englishHintPattern);
    return englishHints >= 2 ? "english" : "latin";
  }

  return top.language;
}

export function languageMatchesSource(
  detectedLanguage: LyricLanguage,
  sourceLanguage: LyricLanguage,
) {
  if (sourceLanguage === "unknown") {
    return true;
  }

  if (detectedLanguage === sourceLanguage) {
    return true;
  }

  if (
    (detectedLanguage === "english" || detectedLanguage === "latin") &&
    (sourceLanguage === "english" || sourceLanguage === "latin")
  ) {
    return true;
  }

  return false;
}
