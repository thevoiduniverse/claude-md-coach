import type { ClaudeMdFile, CrossFileFinding } from "../types.js";

export function analyzeCrossFile(files: ClaudeMdFile[]): CrossFileFinding[] {
  const findings: CrossFileFinding[] = [];
  if (files.length < 2) return findings;

  for (let i = 0; i < files.length; i++) {
    for (let j = i + 1; j < files.length; j++) {
      const a = files[i];
      const b = files[j];
      for (const ra of a.rules) {
        for (const rb of b.rules) {
          const sim = jaccard(new Set(ra.keywords), new Set(rb.keywords));
          if (sim >= 0.55 && ra.keywords.length >= 3) {
            findings.push({
              kind: "duplicate",
              rules: [ra, rb],
              files: [a.path, b.path],
              suggestion: `Likely duplicate rule — keep one at the scope that actually applies. Similarity: ${Math.round(sim * 100)}%`,
            });
          }
        }
      }
    }
  }
  return findings;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}
