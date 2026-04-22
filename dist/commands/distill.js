import { createInterface } from "node:readline/promises";
import { stdin, stdout, stderr } from "node:process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { parseClaudeMd } from "../parsers/claude-md-parser.js";
import { discover } from "../parsers/discovery.js";
import { listSessionFiles, parseSession } from "../parsers/session-parser.js";
import { sessionsForFile } from "../analyzers/scope.js";
import { pickDistillCandidates, distillSection, verifyReplay, progressiveDistill, } from "../analyzers/distill.js";
import { ClaudeRunner } from "../llm/runner.js";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";
export async function runDistill(workspaceRoot, flags) {
    const runner = new ClaudeRunner();
    const available = await runner.checkAvailable();
    if (!available) {
        stderr.write(`${RED}Error:${RESET} claude CLI not found on PATH.\n`);
        process.exit(1);
    }
    stderr.write(`${DIM}Scanning workspace…${RESET}\n`);
    const discovered = await discover(workspaceRoot);
    if (discovered.length === 0) {
        stdout.write("No CLAUDE.md files found.\n");
        return;
    }
    const files = discovered.map(d => parseClaudeMd(d.path, d.scope, d.projectName));
    stderr.write(`${DIM}Reading session history…${RESET}\n`);
    const sessionFiles = await listSessionFiles();
    const sessions = [];
    for (const sf of sessionFiles) {
        const s = await parseSession(sf);
        if (s)
            sessions.push(s);
    }
    const rl = createInterface({ input: stdin, output: stdout });
    try {
        for (const file of files) {
            const scoped = sessionsForFile(file, sessions);
            const candidates = pickDistillCandidates(file);
            stdout.write(`\n${BOLD}${shortPath(file.path)}${RESET}  ${DIM}${file.lines} lines, ${candidates.length} distillable section${candidates.length === 1 ? "" : "s"}${RESET}\n`);
            if (candidates.length === 0) {
                stdout.write(`${DIM}No sections large enough to distill.${RESET}\n`);
                continue;
            }
            for (const c of candidates) {
                stdout.write(`\n${BOLD}Section:${RESET} ${c.section.title} ${DIM}(${c.originalLines} lines, ${c.ruleCount} rules)${RESET}\n`);
                const goAhead = (await rl.question(`  Distill? ${BOLD}[y/N/skip-file]${RESET} `)).trim().toLowerCase();
                if (goAhead === "skip-file")
                    break;
                if (goAhead !== "y" && goAhead !== "yes")
                    continue;
                if (flags.progressive && scoped.length >= 2) {
                    stderr.write(`  ${DIM}Progressive distillation (compresses iteratively, verifies each round)…${RESET}\n`);
                    const prog = await progressiveDistill(c, scoped, runner, { maxIterations: 4, minSimilarity: 80 });
                    stdout.write(`  ${DIM}Stopped after ${prog.iterations.length} iteration${prog.iterations.length === 1 ? "" : "s"} (${prog.stoppedReason.replaceAll("_", " ")}).${RESET}\n`);
                    for (const it of prog.iterations) {
                        const mark = it.accepted ? GREEN + "✓" : RED + "✗";
                        stdout.write(`    ${mark}${RESET} iter ${it.iteration}: ${it.beforeLines}→${it.afterLines} lines, similarity ${it.similarity}/100\n`);
                    }
                    if (prog.reductionPct === 0) {
                        stdout.write(`  ${YELLOW}No stable reduction found. Original preserved.${RESET}\n`);
                        continue;
                    }
                    stdout.write(`  ${GREEN}Final: ${c.originalLines}→${prog.finalLines} lines (${prog.reductionPct}% reduction), verified stable.${RESET}\n\n`);
                    stdout.write(`${DIM}─── BEFORE ─────────────────${RESET}\n`);
                    stdout.write(indentBlock(c.originalText, "  "));
                    stdout.write(`\n${DIM}─── AFTER ──────────────────${RESET}\n`);
                    stdout.write(indentBlock(prog.finalText, "  "));
                    stdout.write("\n");
                    const apply = (await rl.question(`\n  Apply? ${BOLD}[y/N]${RESET} `)).trim().toLowerCase();
                    if (apply === "y" || apply === "yes") {
                        applySectionReplacement(file.path, c.section.startLine, c.section.endLine, prog.finalText);
                        stdout.write(`  ${GREEN}✓ Applied.${RESET}\n`);
                        break;
                    }
                    else {
                        stdout.write(`  ${DIM}Skipped.${RESET}\n`);
                        continue;
                    }
                }
                stderr.write(`  ${DIM}Compressing…${RESET}\n`);
                const compressed = await distillSection(c, runner);
                if (!compressed) {
                    stdout.write(`  ${RED}Compression failed.${RESET}\n`);
                    continue;
                }
                stdout.write(`  ${DIM}Compressed: ${c.originalLines} → ${compressed.compressedLines} lines (${compressed.reductionPct}% reduction)${RESET}\n\n`);
                stdout.write(`${DIM}─── BEFORE (${c.originalLines} lines) ─────────────────${RESET}\n`);
                stdout.write(indentBlock(c.originalText, "  "));
                stdout.write(`\n${DIM}─── AFTER (${compressed.compressedLines} lines) ──────────────────${RESET}\n`);
                stdout.write(indentBlock(compressed.compressed, "  "));
                stdout.write("\n");
                if (flags.verify && scoped.length >= 2) {
                    stderr.write(`\n  ${DIM}Verifying by replaying ${Math.min(3, scoped.length)} past sessions (uses ~9 Claude calls)…${RESET}\n`);
                    const verify = await verifyReplay(c, compressed.compressed, scoped, runner, 3);
                    const color = verify.verdict === "safe" ? GREEN : YELLOW;
                    stdout.write(`  ${color}Replay score: ${verify.avgSimilarity}/100 (${verify.verdict})${RESET}\n`);
                    for (const r of verify.replays) {
                        stdout.write(`    ${DIM}• ${r.similarity}/100 — ${r.notes}${RESET}\n`);
                    }
                    if (verify.verdict === "risky") {
                        stdout.write(`  ${YELLOW}⚠ Behavior may diverge. Proceed with care.${RESET}\n`);
                    }
                }
                const apply = (await rl.question(`\n  Apply this compression? ${BOLD}[y/N]${RESET} `)).trim().toLowerCase();
                if (apply === "y" || apply === "yes") {
                    applySectionReplacement(file.path, c.section.startLine, c.section.endLine, compressed.compressed);
                    stdout.write(`  ${GREEN}✓ Applied. Backup saved.${RESET}\n`);
                    break;
                }
                else {
                    stdout.write(`  ${DIM}Skipped.${RESET}\n`);
                }
            }
        }
    }
    finally {
        rl.close();
    }
    stdout.write(`\n${BOLD}Done.${RESET}\n`);
}
function applySectionReplacement(filePath, startLine, endLine, newText) {
    const content = readFileSync(filePath, "utf8");
    const lines = content.split("\n");
    const backupDir = join(dirname(filePath), ".claude-md-coach-history");
    if (!existsSync(backupDir))
        mkdirSync(backupDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    writeFileSync(join(backupDir, `${basename(filePath)}.${ts}.md`), content);
    const newLines = newText.split("\n");
    lines.splice(startLine, endLine - startLine + 1, ...newLines);
    writeFileSync(filePath, lines.join("\n"));
}
function indentBlock(text, indent) {
    return text
        .split("\n")
        .map(l => indent + l)
        .join("\n");
}
function shortPath(p) {
    const home = process.env.HOME ?? "";
    if (home && p.startsWith(home))
        return "~" + p.slice(home.length);
    return p;
}
//# sourceMappingURL=distill.js.map