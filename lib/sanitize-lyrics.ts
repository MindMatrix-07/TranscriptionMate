const tagMatchers = [
  { pattern: /^pre\s*-?\s*chorus\b/i, tag: "#PRE-CHORUS" },
  { pattern: /^instrumental\b/i, tag: "#INSTRUMENTAL" },
  { pattern: /^chorus\b/i, tag: "#CHORUS" },
  { pattern: /^bridge\b/i, tag: "#BRIDGE" },
  { pattern: /^verse\b/i, tag: "#VERSE" },
  { pattern: /^intro\b/i, tag: "#INTRO" },
  { pattern: /^outro\b/i, tag: "#OUTRO" },
  { pattern: /^hook\b/i, tag: "#HOOK" },
];

const tagSuffixPattern =
  /^(?:[:\-–—.]|\(\s*[xX]?\d+\s*\)|\[\s*[xX]?\d+\s*\]|\d+|[ivxlcdm]+|\s)+$/i;

function fixTagLine(line: string) {
  const trimmed = line.trim();

  if (!trimmed) {
    return line;
  }

  const normalized = trimmed
    .replace(/^[\[{(<"'`]+/, "")
    .replace(/[\]})>"'`]+$/, "")
    .trim();

  for (const { pattern, tag } of tagMatchers) {
    const match = normalized.match(pattern);

    if (!match) {
      continue;
    }

    const suffix = normalized.slice(match[0].length).trim();

    if (!suffix || tagSuffixPattern.test(suffix)) {
      return tag;
    }
  }

  return line;
}

export function sanitizeLyrics(rawLyrics: string) {
  let text = rawLyrics.replace(/\r\n?/g, "\n");

  text = text.trim();
  text = text.replace(/ {2,}/g, " ");
  text = text.replace(/[ \t]+$/gm, "");
  text = text.replace(/[\u200B-\u200D\uFEFF]/g, "");
  text = text
    .split("\n")
    .map((line) => fixTagLine(line))
    .join("\n");
  text = text.replace(/\s+([,.])/g, "$1");
  text = text.replace(/\n{3,}/g, "\n\n");

  return text.trim();
}

