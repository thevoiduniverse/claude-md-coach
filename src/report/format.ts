import type {
  ClaudeMdFile,
  CrossFileFinding,
  PerFileFinding,
} from "../types.js";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const CYAN = "\x1b[36m";

export interface FormatInput {
  files: ClaudeMdFile[];
  sessionsAnalyzed: number;
  perFile: PerFileFinding[];
  crossFile: CrossFileFinding[];
}

export function formatReport(input: FormatInput): string {
  const lines: string[] = [];
  lines.push("");
  lines.push(`${BOLD}claude-md-coach${RESET} ${DIM}— scan report${RESET}`);
  lines.push("");
  lines.push(
    `Found ${BOLD}${input.files.length}${RESET} CLAUDE.md file${input.files.length === 1 ? "" : "s"}, analyzed ${BOLD}${input.sessionsAnalyzed}${RESET} session${input.sessionsAnalyzed === 1 ? "" : "s"}.`,
  );
  lines.push("");

  for (let i = 0; i < input.files.length; i++) {
    const file = input.files[i];
    const finding = input.perFile.find(f => f.filePath === file.path);
    if (!finding) continue;

    const scopeLabel = file.scope === "global" ? "global" : `project (${file.projectName ?? "root"})`;
    lines.push(
      `${BOLD}${i + 1}.${RESET} ${shortPath(file.path)}  ${DIM}${scopeLabel}, ${file.lines} lines, ${file.rules.length} rules, ${finding.sessionsInScope} sessions in scope${RESET}`,
    );

    const s = finding.sprawl;
    const sprawlColor = s.status === "healthy" ? GREEN : s.status === "warning" ? YELLOW : RED;
    lines.push(`   ${sprawlColor}● ${s.status.toUpperCase()}${RESET}  ${s.recommendation}`);

    if (finding.sessionsInScope === 0) {
      lines.push(`   ${DIM}No sessions ran in this file's scope yet — rule-level analysis unavailable.${RESET}`);
      lines.push("");
      continue;
    }

    const never = finding.neverTriggered;
    const weak = finding.weakSignal;

    if (never.length > 0) {
      lines.push("");
      lines.push(`   ${YELLOW}⚠ ${never.length} rule${never.length === 1 ? "" : "s"} with no detectable trigger${RESET} ${DIM}— either dead, or purely advisory (deterministic detection can't see them)${RESET}`);
      for (const r of never.slice(0, 8)) {
        lines.push(`      ${DIM}${r.id}${RESET} ${truncate(r.text, 100)}`);
      }
      if (never.length > 8) {
        lines.push(`      ${DIM}… ${never.length - 8} more${RESET}`);
      }
    }

    if (weak.length > 0) {
      lines.push("");
      lines.push(`   ${CYAN}◐ ${weak.length} weakly-triggered rule${weak.length === 1 ? "" : "s"}${RESET} ${DIM}— matched 1-2 sessions${RESET}`);
      for (const r of weak.slice(0, 5)) {
        lines.push(`      ${DIM}${r.id}${RESET} ${truncate(r.text, 100)}`);
      }
      if (weak.length > 5) {
        lines.push(`      ${DIM}… ${weak.length - 5} more${RESET}`);
      }
    }

    if (never.length === 0 && weak.length === 0) {
      lines.push(`   ${GREEN}✓ All rules have strong trigger signal${RESET}`);
    }

    lines.push("");
  }

  if (input.crossFile.length > 0) {
    lines.push(`${BOLD}Cross-file findings${RESET}`);
    lines.push("");
    for (const cf of input.crossFile.slice(0, 10)) {
      lines.push(`${YELLOW}⚠${RESET}  Possible duplicate across files:`);
      for (let i = 0; i < cf.rules.length; i++) {
        lines.push(`   ${DIM}${shortPath(cf.files[i])}${RESET} ${cf.rules[i].id}: ${truncate(cf.rules[i].text, 80)}`);
      }
      lines.push(`   ${CYAN}→ ${cf.suggestion}${RESET}`);
      lines.push("");
    }
    if (input.crossFile.length > 10) {
      lines.push(`${DIM}… ${input.crossFile.length - 10} more cross-file findings${RESET}`);
      lines.push("");
    }
  }

  lines.push(`${DIM}Phase 1 is deterministic detection. Phase 2 adds LLM-based correction mining + missing-rule suggestions.${RESET}`);
  lines.push("");

  return lines.join("\n");
}

function shortPath(p: string): string {
  const home = process.env.HOME ?? "";
  if (home && p.startsWith(home)) return "~" + p.slice(home.length);
  return p;
}

function truncate(s: string, n: number): string {
  const clean = s.replace(/\s+/g, " ").trim();
  if (clean.length <= n) return clean;
  return clean.slice(0, n - 1) + "…";
}
