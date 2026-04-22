import type { ClaudeMdFile } from "../types.js";
import type { CorrectionCluster } from "./corrections.js";
import { ClaudeRunner } from "../llm/runner.js";

export interface DraftedRule {
  theme: string;
  draft: string;
  evidence: { sessionId: string; text: string }[];
  confidence: "high" | "medium" | "low";
}

export async function draftRulesInUserVoice(
  file: ClaudeMdFile,
  clusters: CorrectionCluster[],
  runner: ClaudeRunner,
): Promise<DraftedRule[]> {
  if (clusters.length === 0) return [];

  const sample = file.rules
    .slice(0, 8)
    .map(r => `- ${r.text}`)
    .join("\n");

  const clusterBlock = clusters
    .map((c, i) => {
      const ex = c.signals.slice(0, 3).map(s => `  • "${s.text.slice(0, 180)}"`).join("\n");
      return `[${i}] Theme: ${c.theme}
Seed draft: ${c.candidateRule ?? ""}
Example corrections:
${ex}`;
    })
    .join("\n\n");

  const prompt = `You are helping a developer refine new CLAUDE.md rules based on corrections they've repeatedly made to Claude. Rewrite each "seed draft" below to match the voice and style of their existing rules.

STYLE SAMPLE (match this voice):
${sample}

RULES TO DRAFT:
${clusterBlock}

For each theme, output a JSON object with:
- "index": the cluster index
- "draft": the refined rule in the user's voice (one sentence, imperative, specific, under 200 characters)

Output a JSON array with one entry per theme. Only output the JSON, no commentary.`;

  const result = await runner.runJson<Array<{ index?: number; draft?: string }>>(prompt, {
    model: "haiku",
  });

  const drafts: DraftedRule[] = [];
  if (!result || !Array.isArray(result)) {
    for (const c of clusters) {
      if (!c.candidateRule) continue;
      drafts.push({
        theme: c.theme,
        draft: c.candidateRule,
        evidence: c.signals.slice(0, 5).map(s => ({ sessionId: s.sessionId, text: s.text })),
        confidence: c.confidence,
      });
    }
    return drafts;
  }

  for (let i = 0; i < result.length; i++) {
    const r = result[i];
    if (!r) continue;
    const idx = typeof r.index === "number" ? r.index : i;
    if (idx < 0 || idx >= clusters.length) continue;
    const c = clusters[idx];
    drafts.push({
      theme: c.theme,
      draft: r.draft ?? c.candidateRule ?? "",
      evidence: c.signals.slice(0, 5).map(s => ({ sessionId: s.sessionId, text: s.text })),
      confidence: c.confidence,
    });
  }
  return drafts;
}
