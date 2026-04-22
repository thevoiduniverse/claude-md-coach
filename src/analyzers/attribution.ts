import type { ClaudeMdFile, Session } from "../types.js";

export interface AttributionStats {
  ruleId: string;
  citations: number;
  sessions: string[];
}

const CITATION_PATTERN = /\[(R\d+)\]/g;

export function analyzeAttribution(
  file: ClaudeMdFile,
  sessions: Session[],
): Map<string, AttributionStats> {
  const stats = new Map<string, AttributionStats>();
  const knownIds = new Set(file.rules.map(r => r.id));
  for (const r of file.rules) stats.set(r.id, { ruleId: r.id, citations: 0, sessions: [] });

  for (const s of sessions) {
    const hitsThisSession = new Set<string>();
    for (const e of s.events) {
      if (e.type === "thinking" || e.type === "assistant_text") {
        const m = (e.content ?? "").matchAll(CITATION_PATTERN);
        for (const match of m) {
          const id = match[1];
          if (knownIds.has(id)) hitsThisSession.add(id);
        }
      }
    }
    for (const id of hitsThisSession) {
      const entry = stats.get(id);
      if (entry) {
        entry.citations++;
        entry.sessions.push(s.sessionId);
      }
    }
  }
  return stats;
}

export function topAndBottom(stats: Map<string, AttributionStats>, n = 5): {
  top: AttributionStats[];
  bottom: AttributionStats[];
} {
  const arr = Array.from(stats.values());
  arr.sort((a, b) => b.citations - a.citations);
  return {
    top: arr.slice(0, n),
    bottom: arr.filter(s => s.citations === 0).slice(0, n),
  };
}
