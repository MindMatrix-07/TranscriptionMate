import type {
  AuditCandidateMatch,
  AuditCandidateMatchSample,
  AuditWebEvidence,
} from "@/lib/source-audit";
import { getComparableLyricLines } from "@/lib/source-audit";
import type { SiteProfile } from "@/lib/training-store";

type NormalizedLine = {
  raw: string;
  normalized: string;
  words: string[];
};

type ComparisonText = {
  comparisonSource: "page" | "snippet";
  fetched: boolean;
  text: string;
};

const fetchTimeoutMs = 12000;
const nearMatchThreshold = 0.78;
const lowValueLinePatterns = [
  /^advertisement$/i,
  /^embed$/i,
  /^share$/i,
  /^copy$/i,
  /^follow us/i,
  /^privacy policy$/i,
  /^cookie policy$/i,
  /^terms of use$/i,
  /^all rights reserved$/i,
  /^submit corrections$/i,
  /^you might also like$/i,
];
const nonLyricDomainSignals = [
  {
    label: "Discussion forum pattern",
    pattern: /\b(?:forum|reddit|wordreference|thread)\b/i,
  },
  {
    label: "Grammar or dictionary pattern",
    pattern: /\b(?:dictionary|grammar|thesaurus|synonym|usage)\b/i,
  },
  {
    label: "Professional network pattern",
    pattern: /\b(?:linkedin|indeed)\b/i,
  },
];

function safeDomainFromUrl(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return value;
  }
}

function deriveSiteName(domain: string, siteProfiles: SiteProfile[]) {
  const matchedProfile = siteProfiles.find(
    (profile) => profile.domain === domain || domain.endsWith(`.${profile.domain}`),
  );

  if (matchedProfile) {
    return matchedProfile.name;
  }

  const label = domain.split(".")[0] ?? domain;
  return label
    .split(/[-_]/g)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function decodeHtmlEntities(value: string) {
  const named = value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");

  return named
    .replace(/&#(\d+);/g, (_, code) => {
      const parsed = Number(code);
      return Number.isFinite(parsed) ? String.fromCodePoint(parsed) : "";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => {
      const parsed = Number.parseInt(code, 16);
      return Number.isFinite(parsed) ? String.fromCodePoint(parsed) : "";
    });
}

function htmlToText(value: string) {
  return decodeHtmlEntities(
    value
      .replace(/<script[\s\S]*?<\/script>/gi, "\n")
      .replace(/<style[\s\S]*?<\/style>/gi, "\n")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, "\n")
      .replace(/<!--[\s\S]*?-->/g, "\n")
      .replace(/<(?:br|\/p|\/div|\/li|\/h\d|\/article|\/section|\/tr|\/ul|\/ol)[^>]*>/gi, "\n")
      .replace(/<(?:li|p|div|article|section|tr|ul|ol|h\d)[^>]*>/gi, "\n")
      .replace(/<\/td>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function normalizeLine(value: string) {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['"`’]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildNormalizedLines(lines: string[]) {
  return lines
    .map((raw) => {
      const normalized = normalizeLine(raw);
      return {
        normalized,
        raw,
        words: normalized.split(" ").filter(Boolean),
      } satisfies NormalizedLine;
    })
    .filter((line) => line.normalized.length >= 4 && line.words.length >= 2);
}

function extractCandidateLines(text: string) {
  const unique = new Set<string>();
  const lines = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length >= 8 && line.length <= 220)
    .filter(
      (line) => !lowValueLinePatterns.some((pattern) => pattern.test(line)),
    );

  const filtered: string[] = [];

  for (const line of lines) {
    const normalized = normalizeLine(line);

    if (!normalized || unique.has(normalized)) {
      continue;
    }

    unique.add(normalized);
    filtered.push(line);

    if (filtered.length >= 600) {
      break;
    }
  }

  return filtered;
}

function getTokenJaccard(left: string[], right: string[]) {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  let intersection = 0;

  for (const token of leftSet) {
    if (rightSet.has(token)) {
      intersection += 1;
    }
  }

  const union = leftSet.size + rightSet.size - intersection;
  return union > 0 ? intersection / union : 0;
}

function getOrderedPrefixRatio(left: string[], right: string[]) {
  const limit = Math.min(left.length, right.length);
  let shared = 0;

  while (shared < limit && left[shared] === right[shared]) {
    shared += 1;
  }

  return limit > 0 ? shared / limit : 0;
}

function scoreLineSimilarity(left: NormalizedLine, right: NormalizedLine) {
  if (!left.normalized || !right.normalized) {
    return 0;
  }

  if (left.normalized === right.normalized) {
    return 1;
  }

  const minLength = Math.min(left.normalized.length, right.normalized.length);
  const maxLength = Math.max(left.normalized.length, right.normalized.length);
  const lengthRatio = maxLength > 0 ? minLength / maxLength : 0;

  if (
    minLength >= 12 &&
    (left.normalized.includes(right.normalized) ||
      right.normalized.includes(left.normalized))
  ) {
    return 0.88 * lengthRatio + 0.12;
  }

  const tokenJaccard = getTokenJaccard(left.words, right.words);
  const prefixRatio = getOrderedPrefixRatio(left.words, right.words);

  return tokenJaccard * 0.7 + prefixRatio * 0.15 + lengthRatio * 0.15;
}

function isRareLine(line: NormalizedLine) {
  return line.normalized.length >= 24 || new Set(line.words).size >= 5;
}

function buildSampleMatches(
  inputLines: NormalizedLine[],
  candidateLines: NormalizedLine[],
) {
  const matches: AuditCandidateMatchSample[] = [];

  for (const inputLine of inputLines) {
    let bestMatch: AuditCandidateMatchSample | null = null;

    for (const candidateLine of candidateLines) {
      const similarity = scoreLineSimilarity(inputLine, candidateLine);

      if (similarity < nearMatchThreshold) {
        continue;
      }

      const type = similarity === 1 ? "exact" : "near";

      if (!bestMatch || similarity > bestMatch.similarity) {
        bestMatch = {
          candidateLine: candidateLine.raw,
          inputLine: inputLine.raw,
          similarity,
          type,
        };
      }
    }

    if (bestMatch) {
      matches.push(bestMatch);
    }
  }

  return matches;
}

function getLongestConsecutiveBlock(
  inputLines: NormalizedLine[],
  candidateLines: NormalizedLine[],
) {
  const previous = new Array(candidateLines.length + 1).fill(0);
  let longest = 0;

  for (let inputIndex = 1; inputIndex <= inputLines.length; inputIndex += 1) {
    const current = new Array(candidateLines.length + 1).fill(0);

    for (
      let candidateIndex = 1;
      candidateIndex <= candidateLines.length;
      candidateIndex += 1
    ) {
      const similarity = scoreLineSimilarity(
        inputLines[inputIndex - 1],
        candidateLines[candidateIndex - 1],
      );

      if (similarity >= nearMatchThreshold) {
        current[candidateIndex] = previous[candidateIndex - 1] + 1;
        longest = Math.max(longest, current[candidateIndex]);
      }
    }

    for (let index = 0; index < current.length; index += 1) {
      previous[index] = current[index];
    }
  }

  return longest;
}

function collectMetadataHits(
  domain: string,
  title: string,
  pageText: string,
  siteProfiles: SiteProfile[],
) {
  const haystack = `${domain}\n${title}\n${pageText}`.toLowerCase();
  const hits: string[] = [];
  const matchedProfile = siteProfiles.find(
    (profile) => profile.domain === domain || domain.endsWith(`.${profile.domain}`),
  );

  if (matchedProfile) {
    hits.push(`Known site profile: ${matchedProfile.name}`);

    for (const fingerprint of matchedProfile.fingerprints.slice(0, 8)) {
      if (fingerprint && haystack.includes(fingerprint.toLowerCase())) {
        hits.push(`Fingerprint: ${fingerprint}`);
      }
    }
  }

  if (haystack.includes(domain.toLowerCase())) {
    hits.push(`Domain mention: ${domain}`);
  }

  return [...new Set(hits)].slice(0, 5);
}

function collectNonLyricSignals(domain: string, pageText: string) {
  const haystack = `${domain}\n${pageText}`.toLowerCase();

  return nonLyricDomainSignals
    .filter((signal) => signal.pattern.test(haystack))
    .map((signal) => signal.label);
}

async function fetchComparisonText(
  url: string,
  fallbackSnippet: string,
): Promise<ComparisonText> {
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(fetchTimeoutMs),
    });

    if (!response.ok) {
      throw new Error(`Page fetch failed with status ${response.status}`);
    }

    const html = await response.text();
    const text = htmlToText(html);

    if (!text.trim()) {
      throw new Error("Fetched page did not contain readable text");
    }

    return {
      comparisonSource: "page",
      fetched: true,
      text,
    };
  } catch {
    return {
      comparisonSource: "snippet",
      fetched: false,
      text: fallbackSnippet,
    };
  }
}

function buildCandidateScore(
  exactLineMatches: number,
  nearLineMatches: number,
  rareLineMatches: number,
  longestConsecutiveBlock: number,
  metadataHits: string[],
  nonLyricSignals: string[],
) {
  return Math.max(
    0,
    exactLineMatches * 5 +
      nearLineMatches * 2 +
      rareLineMatches * 4 +
      longestConsecutiveBlock * 4 +
      metadataHits.length * 4 -
      nonLyricSignals.length * 8,
  );
}

export async function compareLyricsAgainstWebEvidence(
  rawLyrics: string,
  webEvidence: AuditWebEvidence[],
  siteProfiles: SiteProfile[],
): Promise<AuditCandidateMatch[]> {
  const inputLines = buildNormalizedLines(getComparableLyricLines(rawLyrics)).slice(0, 80);

  if (inputLines.length === 0 || webEvidence.length === 0) {
    return [];
  }

  const comparisons = await Promise.all(
    webEvidence.slice(0, 5).map(async (evidence) => {
      const comparisonText = await fetchComparisonText(evidence.url, evidence.snippet);
      const domain = safeDomainFromUrl(evidence.url);
      const candidateLines = buildNormalizedLines(
        extractCandidateLines(comparisonText.text),
      );
      const sampleMatches = buildSampleMatches(inputLines, candidateLines).sort(
        (left, right) => right.similarity - left.similarity,
      );
      const exactLineMatches = sampleMatches.filter(
        (match) => match.type === "exact",
      ).length;
      const nearLineMatches = sampleMatches.filter(
        (match) => match.type === "near",
      ).length;
      const rareLineMatches = sampleMatches.filter((match) =>
        isRareLine(
          inputLines.find((line) => line.raw === match.inputLine) ?? inputLines[0],
        ),
      ).length;
      const longestConsecutiveBlock = getLongestConsecutiveBlock(
        inputLines,
        candidateLines,
      );
      const metadataHits = collectMetadataHits(
        domain,
        evidence.title,
        comparisonText.text,
        siteProfiles,
      );
      const nonLyricSignals = collectNonLyricSignals(domain, comparisonText.text);
      const matchedLines = exactLineMatches + nearLineMatches;
      const matchPercentage =
        inputLines.length > 0
          ? Math.round((matchedLines / inputLines.length) * 100)
          : 0;

      return {
        comparisonSource: comparisonText.comparisonSource,
        domain,
        exactLineMatches,
        fetched: comparisonText.fetched,
        inputLineCount: inputLines.length,
        longestConsecutiveBlock,
        matchPercentage,
        matchedLines,
        metadataHits,
        name: deriveSiteName(domain, siteProfiles),
        nearLineMatches,
        nonLyricSignals,
        providerId: evidence.providerId,
        sampleMatches: sampleMatches.slice(0, 5),
        score: buildCandidateScore(
          exactLineMatches,
          nearLineMatches,
          rareLineMatches,
          longestConsecutiveBlock,
          metadataHits,
          nonLyricSignals,
        ),
        title: evidence.title,
        url: evidence.url,
      } satisfies AuditCandidateMatch;
    }),
  );

  return comparisons
    .filter(
      (comparison) =>
        comparison.matchedLines > 0 ||
        comparison.metadataHits.length > 0 ||
        comparison.fetched,
    )
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      if (right.exactLineMatches !== left.exactLineMatches) {
        return right.exactLineMatches - left.exactLineMatches;
      }

      if (right.longestConsecutiveBlock !== left.longestConsecutiveBlock) {
        return right.longestConsecutiveBlock - left.longestConsecutiveBlock;
      }

      return right.matchPercentage - left.matchPercentage;
    });
}

export function summarizeCandidateMatches(candidateMatches: AuditCandidateMatch[]) {
  const topCandidate = candidateMatches[0];
  const runnerUp = candidateMatches[1];

  if (!topCandidate) {
    return {
      decisive: false,
      summary: "No fetched candidate page produced usable line matches yet.",
      topCandidate: null,
    };
  }

  const leadScore = topCandidate.score - (runnerUp?.score ?? 0);
  const decisive =
    topCandidate.exactLineMatches >= 2 &&
    topCandidate.longestConsecutiveBlock >= 2 &&
    (leadScore >= 4 || topCandidate.matchPercentage >= 45);

  const summary = `${topCandidate.name} leads with ${topCandidate.exactLineMatches} exact line match${
    topCandidate.exactLineMatches === 1 ? "" : "es"
  }, ${topCandidate.nearLineMatches} near match${
    topCandidate.nearLineMatches === 1 ? "" : "es"
  }, and a ${topCandidate.longestConsecutiveBlock}-line consecutive block.`;

  return {
    decisive,
    summary,
    topCandidate,
  };
}
