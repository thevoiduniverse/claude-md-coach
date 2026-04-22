import type { ClaudeMdFile, SprawlReport } from "../types.js";

const HEALTHY_MAX_LINES = 150;
const WARNING_MAX_LINES = 300;

export function analyzeSprawl(file: ClaudeMdFile): SprawlReport {
  const ruleCount = file.rules.length;
  const totalRuleChars = file.rules.reduce((a, r) => a + r.text.length, 0);
  const avgRuleLength = ruleCount === 0 ? 0 : Math.round(totalRuleChars / ruleCount);

  let status: SprawlReport["status"];
  let recommendation: string;

  if (file.lines <= HEALTHY_MAX_LINES) {
    status = "healthy";
    recommendation = "Size is within the recommended range.";
  } else if (file.lines <= WARNING_MAX_LINES) {
    status = "warning";
    recommendation = `File is ${file.lines} lines. Research shows instruction-following degrades past ~150 lines; recommend trimming toward 150.`;
  } else {
    status = "bloated";
    recommendation = `File is ${file.lines} lines, past the 300-line threshold where most rules get ignored. Priority: trim aggressively, move rules to path-scoped files.`;
  }

  return { lines: file.lines, ruleCount, avgRuleLength, status, recommendation };
}
