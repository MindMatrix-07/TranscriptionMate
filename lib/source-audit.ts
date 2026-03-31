import type { SourceReport } from "@/lib/source-detector";

export type AuditConfidence = "low" | "medium" | "high";

export type AuditManualSearch = {
  label: string;
  url: string;
};

export type AuditWebEvidence = {
  providerId: string;
  score?: number | null;
  snippet: string;
  title: string;
  url: string;
};

export type AuditCandidateMatchSample = {
  candidateLine: string;
  inputLine: string;
  similarity: number;
  type: "exact" | "near";
};

export type AuditCandidateMatch = {
  comparisonSource: "page" | "snippet";
  domain: string;
  exactLineMatches: number;
  fetched: boolean;
  inputLineCount: number;
  longestConsecutiveBlock: number;
  matchPercentage: number;
  matchedLines: number;
  metadataHits: string[];
  name: string;
  nearLineMatches: number;
  nonLyricSignals: string[];
  providerId: string;
  sampleMatches: AuditCandidateMatchSample[];
  score: number;
  title: string;
  url: string;
};

export type SourceAuditResult = {
  aiArtifacts: string[];
  auditRunId?: string | null;
  candidateMatches?: AuditCandidateMatch[];
  confidence: AuditConfidence;
  heuristic: SourceReport;
  indicators: string[];
  likelySourceDomain: string | null;
  likelySourceName: string | null;
  manualSearches: AuditManualSearch[];
  mode: "ai" | "heuristic";
  providerChain?: string[];
  providerId?: string | null;
  providerConfigured: boolean;
  rationale: string;
  recommendedAction: string;
  spamProbability: number;
  webEvidence?: AuditWebEvidence[];
};

function buildGoogleSearch(query: string) {
  const params = new URLSearchParams({ q: query });
  return `https://www.google.com/search?${params.toString()}`;
}

function isComparableLyricsLine(line: string) {
  return (
    line.length >= 8 &&
    !line.startsWith("#") &&
    !/^\[[^\]]+\]$/.test(line) &&
    !/^\([^)]+\)$/.test(line)
  );
}

function getQueryPriority(line: string) {
  const words = line
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const uniqueWords = new Set(words).size;

  return uniqueWords * 4 + Math.min(line.length, 80) / 6;
}

export function getComparableLyricLines(rawLyrics: string) {
  return rawLyrics
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => isComparableLyricsLine(line));
}

export function getSearchableLines(rawLyrics: string) {
  return getComparableLyricLines(rawLyrics)
    .sort((left, right) => getQueryPriority(right) - getQueryPriority(left))
    .slice(0, 3);
}

export function buildManualSearchLinks(
  rawLyrics: string,
  likelySourceDomain?: string | null,
) {
  const lines = getSearchableLines(rawLyrics);
  const firstLine = lines[0];
  const secondLine = lines[1];
  const searches: AuditManualSearch[] = [];

  if (firstLine && likelySourceDomain) {
    searches.push({
      label: `Search first line on ${likelySourceDomain}`,
      url: buildGoogleSearch(`site:${likelySourceDomain} "${firstLine}"`),
    });
  }

  if (firstLine) {
    searches.push({
      label: "Search exact first line",
      url: buildGoogleSearch(`"${firstLine}"`),
    });
  }

  if (secondLine) {
    searches.push({
      label: "Search a second lyric line",
      url: buildGoogleSearch(`"${secondLine}"`),
    });
  }

  return searches;
}
