import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { stdout } from "node:process";
import type { PendingSummary } from "./pending.js";

const HISTORY_DIR = join(homedir(), ".cache", "claude-md-coach", "history");

const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";

export function runHistory(limit: number = 10): void {
  if (!existsSync(HISTORY_DIR)) {
    stdout.write("No scan history yet. Run `claude-md-coach scan` first.\n");
    return;
  }
  const files = readdirSync(HISTORY_DIR).filter(f => f.endsWith(".json")).sort().reverse();
  if (files.length === 0) {
    stdout.write("No scan history yet.\n");
    return;
  }

  const recent = files.slice(0, limit);
  const scans: PendingSummary[] = [];
  for (const f of recent) {
    try {
      scans.push(JSON.parse(readFileSync(join(HISTORY_DIR, f), "utf8")));
    } catch {}
  }

  if (scans.length === 0) {
    stdout.write("History exists but couldn't be read.\n");
    return;
  }

  stdout.write(`\n${BOLD}claude-md-coach — last ${scans.length} scan${scans.length === 1 ? "" : "s"}${RESET}\n\n`);

  const byFile = new Map<string, Array<{ ts: string; dead: number; weak: number; status: string }>>();
  for (const s of scans) {
    for (const f of s.byFile) {
      const list = byFile.get(f.path) ?? [];
      list.push({
        ts: s.generatedAt,
        dead: f.dead,
        weak: f.weakSignal,
        status: f.sprawlStatus,
      });
      byFile.set(f.path, list);
    }
  }

  for (const [path, points] of byFile) {
    stdout.write(`${BOLD}${shortPath(path)}${RESET}\n`);
    points.reverse();
    for (const p of points) {
      const color = p.status === "healthy" ? GREEN : p.status === "warning" ? YELLOW : RED;
      stdout.write(`  ${DIM}${formatTs(p.ts)}${RESET}  ${color}${p.status.padEnd(8)}${RESET}  ${DIM}dead:${RESET}${p.dead}  ${DIM}weak:${RESET}${p.weak}\n`);
    }
    stdout.write("\n");
  }

  const latest = scans[0];
  const oldest = scans[scans.length - 1];
  stdout.write(`${DIM}Spanning ${formatTs(oldest.generatedAt)} → ${formatTs(latest.generatedAt)}${RESET}\n`);
  stdout.write(`${DIM}Full snapshots: ${HISTORY_DIR}${RESET}\n\n`);
}

function shortPath(p: string): string {
  const home = process.env.HOME ?? "";
  if (home && p.startsWith(home)) return "~" + p.slice(home.length);
  return p;
}

function formatTs(ts: string): string {
  return ts.slice(0, 16).replace("T", " ");
}
