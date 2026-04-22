import type { ClaudeMdFile, Rule, Session } from "../types.js";

export type RuleSignal = "strong" | "weak" | "none";

export interface RuleTriggerStats {
  ruleId: string;
  triggerCount: number;
  sessionsHit: string[];
  keywordsMatched: string[];
  signal: RuleSignal;
}

export interface DeadRuleAnalysis {
  perRule: RuleTriggerStats[];
  neverTriggered: Rule[];
  weakSignal: Rule[];
}

const MIN_KEYWORDS_FOR_MATCH = 2;
const MIN_OVERLAP_RATIO = 0.25;

export function analyzeDeadRules(file: ClaudeMdFile, sessions: Session[]): DeadRuleAnalysis {
  const sessionBlobs = sessions.map(s => ({
    sessionId: s.sessionId,
    blob: buildSessionBlob(s),
  }));

  const perRule: RuleTriggerStats[] = [];
  const neverTriggered: Rule[] = [];
  const weakSignal: Rule[] = [];

  for (const rule of file.rules) {
    const keywords = rule.keywords;
    if (keywords.length === 0) {
      perRule.push({
        ruleId: rule.id,
        triggerCount: 0,
        sessionsHit: [],
        keywordsMatched: [],
        signal: "none",
      });
      neverTriggered.push(rule);
      continue;
    }

    const sessionsHit: string[] = [];
    const keywordsMatched = new Set<string>();

    for (const sb of sessionBlobs) {
      const matches: string[] = [];
      for (const kw of keywords) {
        if (kw.length < 4) continue;
        if (sb.blob.includes(kw)) matches.push(kw);
      }
      const overlap = matches.length / Math.max(1, keywords.length);
      if (matches.length >= MIN_KEYWORDS_FOR_MATCH && overlap >= MIN_OVERLAP_RATIO) {
        sessionsHit.push(sb.sessionId);
        for (const m of matches) keywordsMatched.add(m);
      }
    }

    const signal: RuleSignal =
      sessionsHit.length === 0 ? "none" : sessionsHit.length < 3 ? "weak" : "strong";

    perRule.push({
      ruleId: rule.id,
      triggerCount: sessionsHit.length,
      sessionsHit,
      keywordsMatched: Array.from(keywordsMatched),
      signal,
    });

    if (signal === "none") neverTriggered.push(rule);
    else if (signal === "weak") weakSignal.push(rule);
  }

  return { perRule, neverTriggered, weakSignal };
}

function buildSessionBlob(s: Session): string {
  const parts: string[] = [];
  for (const e of s.events) {
    if (e.type === "user_message") parts.push(e.content.toLowerCase());
    else if (e.type === "tool_use") {
      if (e.toolName) parts.push(e.toolName.toLowerCase());
      if (e.content) parts.push(e.content.toLowerCase());
      if (e.filePath) parts.push(e.filePath.toLowerCase());
      if (e.toolInput) {
        for (const v of Object.values(e.toolInput)) {
          if (typeof v === "string") parts.push(v.toLowerCase().slice(0, 500));
        }
      }
    }
  }
  return parts.join(" ");
}
