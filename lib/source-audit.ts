import type { SourceReport } from "@/lib/source-detector";

export type AuditConfidence = "low" | "medium" | "high";

export type AuditManualSearch = {
  label: string;
  url: string;
};

export type SourceAuditResult = {
  aiArtifacts: string[];
  confidence: AuditConfidence;
  heuristic: SourceReport;
  indicators: string[];
  likelySourceDomain: string | null;
  likelySourceName: string | null;
  manualSearches: AuditManualSearch[];
  mode: "ai" | "heuristic";
  providerConfigured: boolean;
  rationale: string;
  recommendedAction: string;
  spamProbability: number;
};

function buildGoogleSearch(query: string) {
  const params = new URLSearchParams({ q: query });
  return `https://www.google.com/search?${params.toString()}`;
}

function getSearchableLines(rawLyrics: string) {
  return rawLyrics
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.length >= 8 &&
        !line.startsWith("#") &&
        !/^\[[^\]]+\]$/.test(line) &&
        !/^\([^)]+\)$/.test(line),
    )
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

