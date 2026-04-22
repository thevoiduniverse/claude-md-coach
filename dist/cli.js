#!/usr/bin/env node
import { resolve } from "node:path";
import { parseClaudeMd } from "./parsers/claude-md-parser.js";
import { discover } from "./parsers/discovery.js";
import { listSessionFiles, parseSession } from "./parsers/session-parser.js";
import { sessionsForFile } from "./analyzers/scope.js";
import { analyzeDeadRules } from "./analyzers/dead-rules.js";
import { analyzeSprawl } from "./analyzers/sprawl.js";
import { analyzeCrossFile } from "./analyzers/cross-file.js";
import { formatReport } from "./report/format.js";
import { runFix } from "./commands/fix.js";
import { runDistill } from "./commands/distill.js";
import { runPending, savePending } from "./commands/pending.js";
import { runHistory } from "./commands/history.js";
async function main() {
    const args = process.argv.slice(2);
    const cmd = args[0] ?? "scan";
    const rest = args.slice(1);
    const quiet = rest.includes("--quiet") || rest.includes("-q");
    const verify = rest.includes("--verify");
    const progressive = rest.includes("--progressive");
    const positional = rest.filter(a => !a.startsWith("-"));
    if (cmd === "scan") {
        const workspace = resolve(positional[0] ?? process.cwd());
        await runScan(workspace, quiet);
    }
    else if (cmd === "fix") {
        const workspace = resolve(positional[0] ?? process.cwd());
        await runFix(workspace);
    }
    else if (cmd === "distill") {
        const workspace = resolve(positional[0] ?? process.cwd());
        await runDistill(workspace, { verify, progressive });
    }
    else if (cmd === "pending") {
        runPending();
    }
    else if (cmd === "history") {
        const n = Number.parseInt(positional[0] ?? "10", 10);
        runHistory(Number.isFinite(n) ? n : 10);
    }
    else if (cmd === "help" || cmd === "--help" || cmd === "-h") {
        printHelp();
    }
    else {
        console.error(`Unknown command: ${cmd}`);
        printHelp();
        process.exit(1);
    }
}
async function runScan(workspaceRoot, quiet) {
    if (!quiet)
        process.stderr.write(`Scanning ${workspaceRoot}…\n`);
    const discovered = await discover(workspaceRoot);
    if (discovered.length === 0) {
        if (!quiet) {
            console.log("\nNo CLAUDE.md files found.");
            console.log(`Searched: ${workspaceRoot}\n`);
        }
        savePending({
            generatedAt: new Date().toISOString(),
            workspace: workspaceRoot,
            totalFiles: 0,
            totalDead: 0,
            totalContradictions: 0,
            totalDrafts: 0,
            byFile: [],
        });
        return;
    }
    if (!quiet)
        process.stderr.write(`Found ${discovered.length} CLAUDE.md file(s). Parsing…\n`);
    const files = discovered.map(d => parseClaudeMd(d.path, d.scope, d.projectName));
    if (!quiet)
        process.stderr.write("Reading session history…\n");
    const sessionFiles = await listSessionFiles();
    const sessions = [];
    let parsed = 0;
    for (const sf of sessionFiles) {
        const s = await parseSession(sf);
        if (s)
            sessions.push(s);
        parsed++;
        if (!quiet && parsed % 20 === 0) {
            process.stderr.write(`  parsed ${parsed}/${sessionFiles.length}…\n`);
        }
    }
    if (!quiet)
        process.stderr.write(`Analyzed ${sessions.length} sessions.\n`);
    const perFile = [];
    for (const file of files) {
        const scoped = sessionsForFile(file, sessions);
        const analysis = analyzeDeadRules(file, scoped);
        const sprawl = analyzeSprawl(file);
        const triggerCounts = {};
        for (const t of analysis.perRule)
            triggerCounts[t.ruleId] = t.triggerCount;
        perFile.push({
            filePath: file.path,
            neverTriggered: analysis.neverTriggered,
            weakSignal: analysis.weakSignal,
            sprawl,
            triggerCounts,
            sessionsInScope: scoped.length,
        });
    }
    const crossFile = analyzeCrossFile(files);
    savePending({
        generatedAt: new Date().toISOString(),
        workspace: workspaceRoot,
        totalFiles: files.length,
        totalDead: perFile.reduce((a, f) => a + f.neverTriggered.length, 0),
        totalContradictions: 0,
        totalDrafts: 0,
        byFile: perFile.map(f => ({
            path: f.filePath,
            dead: f.neverTriggered.length,
            weakSignal: f.weakSignal.length,
            sprawlStatus: f.sprawl.status,
        })),
    });
    if (!quiet) {
        const report = formatReport({
            files,
            sessionsAnalyzed: sessions.length,
            perFile,
            crossFile,
        });
        console.log(report);
    }
}
function printHelp() {
    console.log(`
claude-md-coach — ambient coach for your CLAUDE.md files

Usage:
  claude-md-coach scan [workspace] [--quiet]   Scan workspace; print report (or save silently)
  claude-md-coach fix  [workspace]             Interactive review + rewrite (uses Claude subscription)
  claude-md-coach distill [workspace] [--verify]   Compress bloated sections; optionally replay-verify
  claude-md-coach pending                      Print one-line nudge from cached scan (for hooks)
  claude-md-coach history [N]                  Show trends from the last N scans (default 10)
  claude-md-coach help                         Show this help

Defaults:
  workspace defaults to the current directory

Flags:
  --quiet, -q       Suppress stdout; write cached summary for hooks to read
  --verify          For distill: replay past sessions to verify compressed behavior matches
  --progressive     For distill: iteratively compress and verify until behavior diverges

Requires:
  Node 18+
  claude CLI installed and signed in (for the 'fix' command)
`);
}
main().catch(err => {
    console.error(err);
    process.exit(1);
});
//# sourceMappingURL=cli.js.map