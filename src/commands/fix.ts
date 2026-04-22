import { createInterface } from "node:readline/promises";
import { stdin, stdout, stderr } from "node:process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { parseClaudeMd } from "../parsers/claude-md-parser.js";
import { discover } from "../parsers/discovery.js";
import { listSessionFiles, parseSession } from "../parsers/session-parser.js";
import { sessionsForFile } from "../analyzers/scope.js";
import { analyzeDeadRules } from "../analyzers/dead-rules.js";
import { extractCorrections, clusterCorrections } from "../analyzers/corrections.js";
import { draftRulesInUserVoice, type DraftedRule } from "../analyzers/rule-generator.js";
import { detectContradictions, type Contradiction } from "../analyzers/contradictions.js";
import { classifyRuleAgainstSessions } from "../analyzers/semantic-trigger.js";
import { analyzeCrossFile } from "../analyzers/cross-file.js";
import { analyzeScopeMove, type ScopeMoveSuggestion } from "../analyzers/scope-move.js";
import { ClaudeRunner } from "../llm/runner.js";
import type { ClaudeMdFile, CrossFileFinding, Rule, Session } from "../types.js";

const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";

interface Edit {
  filePath: string;
  kind: "delete" | "insert" | "replace";
  startLine?: number;
  endLine?: number;
  text?: string;
  description: string;
}

export async function runFix(workspaceRoot: string): Promise<void> {
  const runner = new ClaudeRunner();
  const available = await runner.checkAvailable();
  if (!available) {
    stderr.write(`${RED}Error:${RESET} claude CLI not found on PATH.\nInstall Claude Code and sign in first.\n`);
    process.exit(1);
  }

  stderr.write(`${DIM}Scanning workspace…${RESET}\n`);
  const discovered = await discover(workspaceRoot);
  if (discovered.length === 0) {
    stdout.write("\nNo CLAUDE.md files found.\n");
    return;
  }

  const files: ClaudeMdFile[] = discovered.map(d => parseClaudeMd(d.path, d.scope, d.projectName));

  stderr.write(`${DIM}Reading session history…${RESET}\n`);
  const sessionFiles = await listSessionFiles();
  const sessions: Session[] = [];
  for (const sf of sessionFiles) {
    const s = await parseSession(sf);
    if (s) sessions.push(s);
  }
  stderr.write(`${DIM}Analyzed ${sessions.length} sessions.${RESET}\n`);

  const rl = createInterface({ input: stdin, output: stdout });
  const allEdits: Edit[] = [];

  try {
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      stdout.write(`\n${BOLD}File ${i + 1}/${files.length}${RESET}  ${shortPath(file.path)}\n`);
      stdout.write(`${DIM}${file.scope}, ${file.lines} lines, ${file.rules.length} rules${RESET}\n\n`);

      const scoped = sessionsForFile(file, sessions);
      if (scoped.length === 0) {
        stdout.write(`${YELLOW}⚠ 0 sessions in scope — skipping (no data to analyze against).${RESET}\n`);
        continue;
      }

      const deadAnalysis = analyzeDeadRules(file, scoped);
      if (deadAnalysis.neverTriggered.length > 0) {
        stderr.write(`${DIM}Verifying ${deadAnalysis.neverTriggered.length} rules with LLM (skipping advisory rules that are working silently)…${RESET}\n`);
        const verdicts = await classifyRuleAgainstSessions(
          deadAnalysis.neverTriggered,
          scoped,
          runner,
        );
        const irrelevant = new Set(
          verdicts.filter(v => v.verdict === "irrelevant").map(v => v.ruleId),
        );
        const trueDead = deadAnalysis.neverTriggered.filter(r => irrelevant.has(r.id));
        const violated = verdicts.filter(v => v.verdict === "violated");
        if (violated.length > 0) {
          stdout.write(`${YELLOW}⚠ ${violated.length} rule${violated.length === 1 ? "" : "s"} being violated (not dead, but Claude isn't following):${RESET}\n`);
          for (const v of violated.slice(0, 5)) {
            const r = deadAnalysis.neverTriggered.find(x => x.id === v.ruleId);
            if (r) stdout.write(`  ${DIM}${v.ruleId}${RESET} ${r.text.slice(0, 80)} — ${DIM}${v.reason}${RESET}\n`);
          }
          stdout.write("\n");
        }
        await reviewDeadRules(rl, trueDead, file, allEdits);
      }

      if (file.scope === "global") {
        const scopeMoves = analyzeScopeMove(file, sessions);
        if (scopeMoves.length > 0) {
          await reviewScopeMoves(rl, scopeMoves, allEdits);
        }
      }

      stderr.write(`\n${DIM}Detecting contradictions…${RESET}\n`);
      const contradictions = await detectContradictions(file, runner);
      if (contradictions.length > 0) {
        await reviewContradictions(rl, contradictions, file, allEdits);
      } else {
        stdout.write(`${GREEN}✓ No contradictions detected.${RESET}\n`);
      }

      stderr.write(`\n${DIM}Mining corrections…${RESET}\n`);
      const signals = extractCorrections(scoped);
      let drafts: DraftedRule[] = [];
      if (signals.length >= 2) {
        stderr.write(`${DIM}Found ${signals.length} correction signals, clustering…${RESET}\n`);
        const clusters = await clusterCorrections(signals, runner);
        drafts = await draftRulesInUserVoice(file, clusters, runner);
      }
      if (drafts.length > 0) {
        await reviewDrafts(rl, drafts, file, allEdits);
      } else {
        stdout.write(`${GREEN}✓ No missing-rule patterns detected.${RESET}\n`);
      }
    }

    if (files.length >= 2) {
      stderr.write(`\n${DIM}Checking for cross-file duplicates…${RESET}\n`);
      const crossFindings = analyzeCrossFile(files);
      if (crossFindings.length > 0) {
        await reviewCrossFile(rl, crossFindings, allEdits);
      } else {
        stdout.write(`${GREEN}✓ No cross-file duplicates detected.${RESET}\n`);
      }
    }

    if (allEdits.length === 0) {
      stdout.write(`\n${DIM}No changes proposed.${RESET}\n`);
      return;
    }

    stdout.write(`\n${BOLD}Applying ${allEdits.length} change${allEdits.length === 1 ? "" : "s"}${RESET}\n`);
    const byFile = groupByFile(allEdits);
    for (const [filePath, edits] of byFile) {
      const applied = applyEdits(filePath, edits);
      stdout.write(`${GREEN}✓ Updated ${shortPath(filePath)}${RESET}`);
      if (applied.backupPath) {
        stdout.write(` ${DIM}(backup: ${shortPath(applied.backupPath)})${RESET}`);
      }
      stdout.write("\n");
    }
  } finally {
    rl.close();
  }

  stdout.write(`\n${BOLD}Done.${RESET}\n`);
}

async function reviewDeadRules(
  rl: ReturnType<typeof createInterface>,
  candidates: Rule[],
  file: ClaudeMdFile,
  edits: Edit[],
): Promise<void> {
  if (candidates.length === 0) {
    stdout.write(`${GREEN}✓ No truly-dead rules. Advisory rules are working silently.${RESET}\n`);
    return;
  }
  stdout.write(`${YELLOW}⚠ ${candidates.length} rule${candidates.length === 1 ? "" : "s"} confirmed dead by LLM (topic never came up across sampled sessions).${RESET}\n\n`);
  for (const r of candidates) {
    stdout.write(`  ${DIM}${r.id}${RESET} ${r.text}\n`);
    const ans = (await rl.question(`  Delete? ${BOLD}[y/N/skip-all]${RESET} `)).trim().toLowerCase();
    if (ans === "skip-all" || ans === "s") return;
    if (ans === "y" || ans === "yes") {
      edits.push({
        filePath: file.path,
        kind: "delete",
        startLine: r.startLine,
        endLine: r.endLine,
        description: `Delete dead rule ${r.id}: ${r.text.slice(0, 60)}`,
      });
      stdout.write(`  ${GREEN}✓ queued${RESET}\n`);
    }
    stdout.write("\n");
  }
}

async function reviewContradictions(
  rl: ReturnType<typeof createInterface>,
  contradictions: Contradiction[],
  file: ClaudeMdFile,
  edits: Edit[],
): Promise<void> {
  stdout.write(`${YELLOW}⚠ ${contradictions.length} contradiction${contradictions.length === 1 ? "" : "s"} detected.${RESET}\n\n`);
  for (const c of contradictions) {
    stdout.write(`  ${DIM}${c.ruleA.id}${RESET} ${c.ruleA.text}\n`);
    stdout.write(`  ${DIM}${c.ruleB.id}${RESET} ${c.ruleB.text}\n`);
    stdout.write(`  ${DIM}${c.explanation}${RESET}\n`);
    if (c.unified) stdout.write(`  ${CYAN}→ Unified: ${c.unified}${RESET}\n`);
    const ans = (await rl.question(`  Replace both with unified? ${BOLD}[y/N]${RESET} `)).trim().toLowerCase();
    if ((ans === "y" || ans === "yes") && c.unified) {
      edits.push({
        filePath: file.path,
        kind: "delete",
        startLine: c.ruleA.startLine,
        endLine: c.ruleA.endLine,
        description: `Delete ${c.ruleA.id} (contradiction)`,
      });
      edits.push({
        filePath: file.path,
        kind: "replace",
        startLine: c.ruleB.startLine,
        endLine: c.ruleB.endLine,
        text: `- ${c.unified}`,
        description: `Replace ${c.ruleB.id} with unified rule`,
      });
      stdout.write(`  ${GREEN}✓ queued${RESET}\n`);
    }
    stdout.write("\n");
  }
}

async function reviewDrafts(
  rl: ReturnType<typeof createInterface>,
  drafts: DraftedRule[],
  file: ClaudeMdFile,
  edits: Edit[],
): Promise<void> {
  stdout.write(`${CYAN}💡 ${drafts.length} missing-rule suggestion${drafts.length === 1 ? "" : "s"} based on your corrections.${RESET}\n\n`);
  for (const d of drafts) {
    stdout.write(`  ${BOLD}Theme:${RESET} ${d.theme} ${DIM}(${d.confidence} confidence)${RESET}\n`);
    stdout.write(`  ${CYAN}Draft:${RESET} ${d.draft}\n`);
    stdout.write(`  ${DIM}Evidence:${RESET}\n`);
    for (const ev of d.evidence.slice(0, 3)) {
      stdout.write(`    ${DIM}• "${ev.text.slice(0, 140)}"${RESET}\n`);
    }
    const ans = (await rl.question(`  Add this rule? ${BOLD}[y/N]${RESET} `)).trim().toLowerCase();
    if (ans === "y" || ans === "yes") {
      edits.push({
        filePath: file.path,
        kind: "insert",
        text: `- ${d.draft}`,
        description: `Add rule: ${d.draft.slice(0, 60)}`,
      });
      stdout.write(`  ${GREEN}✓ queued${RESET}\n`);
    }
    stdout.write("\n");
  }
}

async function reviewScopeMoves(
  rl: ReturnType<typeof createInterface>,
  suggestions: ScopeMoveSuggestion[],
  edits: Edit[],
): Promise<void> {
  stdout.write(`\n${CYAN}💡 ${suggestions.length} rule${suggestions.length === 1 ? "" : "s"} might be better scoped to a specific project.${RESET}\n\n`);
  for (const s of suggestions) {
    stdout.write(`  ${DIM}${s.rule.id}${RESET} ${s.rule.text}\n`);
    stdout.write(`  ${DIM}Fires in ${s.hitCount}/${s.totalHits} sessions under ${BOLD}${s.suggestedProjectKey}${RESET}${DIM} (${Math.round(s.concentration * 100)}% of triggers)${RESET}\n`);
    stdout.write(`  ${CYAN}→ Consider moving to ${s.suggestedProjectKey}/CLAUDE.md${RESET}\n`);
    const ans = (await rl.question(`  Remove from global file? ${BOLD}[y/N]${RESET} ${DIM}(you'll need to add it manually to the project file)${RESET} `)).trim().toLowerCase();
    if (ans === "y" || ans === "yes") {
      edits.push({
        filePath: s.fromFile,
        kind: "delete",
        startLine: s.rule.startLine,
        endLine: s.rule.endLine,
        description: `Move ${s.rule.id} toward ${s.suggestedProjectKey}`,
      });
      stdout.write(`  ${GREEN}✓ queued${RESET}\n`);
    }
    stdout.write("\n");
  }
}

async function reviewCrossFile(
  rl: ReturnType<typeof createInterface>,
  findings: CrossFileFinding[],
  edits: Edit[],
): Promise<void> {
  stdout.write(`\n${BOLD}Cross-file findings${RESET}\n`);
  stdout.write(`${YELLOW}⚠ ${findings.length} potential duplicate${findings.length === 1 ? "" : "s"} across files.${RESET}\n\n`);
  for (const f of findings.slice(0, 10)) {
    const [ra, rb] = f.rules;
    const [fa, fb] = f.files;
    stdout.write(`  ${DIM}[${shortPath(fa)}]${RESET} ${ra.id}: ${ra.text.slice(0, 100)}\n`);
    stdout.write(`  ${DIM}[${shortPath(fb)}]${RESET} ${rb.id}: ${rb.text.slice(0, 100)}\n`);
    stdout.write(`  ${DIM}${f.suggestion}${RESET}\n`);
    const ans = (await rl.question(`  Keep which? ${BOLD}[1/2/both/skip]${RESET} `)).trim().toLowerCase();
    if (ans === "1") {
      edits.push({
        filePath: fb,
        kind: "delete",
        startLine: rb.startLine,
        endLine: rb.endLine,
        description: `Remove duplicate ${rb.id} (keep in ${shortPath(fa)})`,
      });
      stdout.write(`  ${GREEN}✓ queued removal from ${shortPath(fb)}${RESET}\n`);
    } else if (ans === "2") {
      edits.push({
        filePath: fa,
        kind: "delete",
        startLine: ra.startLine,
        endLine: ra.endLine,
        description: `Remove duplicate ${ra.id} (keep in ${shortPath(fb)})`,
      });
      stdout.write(`  ${GREEN}✓ queued removal from ${shortPath(fa)}${RESET}\n`);
    }
    stdout.write("\n");
  }
}

function groupByFile(edits: Edit[]): Map<string, Edit[]> {
  const m = new Map<string, Edit[]>();
  for (const e of edits) {
    const list = m.get(e.filePath) ?? [];
    list.push(e);
    m.set(e.filePath, list);
  }
  return m;
}

interface ApplyResult {
  backupPath?: string;
}

function applyEdits(filePath: string, edits: Edit[]): ApplyResult {
  const content = readFileSync(filePath, "utf8");
  const lines = content.split("\n");

  const backupDir = join(dirname(filePath), ".claude-md-coach-history");
  if (!existsSync(backupDir)) mkdirSync(backupDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = join(backupDir, `${basename(filePath)}.${ts}.md`);
  writeFileSync(backupPath, content);

  const lineEdits = edits.filter(e => e.kind === "delete" || e.kind === "replace");
  const inserts = edits.filter(e => e.kind === "insert");

  lineEdits.sort((a, b) => (b.startLine ?? 0) - (a.startLine ?? 0));
  for (const e of lineEdits) {
    const start = e.startLine ?? 0;
    const end = e.endLine ?? start;
    const count = end - start + 1;
    if (e.kind === "delete") {
      lines.splice(start, count);
    } else if (e.kind === "replace") {
      lines.splice(start, count, ...(e.text ?? "").split("\n"));
    }
  }

  if (inserts.length > 0) {
    const block = ["", "## Learned rules", "", ...inserts.map(e => e.text ?? "")];
    if (lines[lines.length - 1] !== "") lines.push("");
    lines.push(...block);
  }

  writeFileSync(filePath, lines.join("\n"));
  return { backupPath };
}

function shortPath(p: string): string {
  const home = process.env.HOME ?? "";
  if (home && p.startsWith(home)) return "~" + p.slice(home.length);
  return p;
}
