import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
const CACHE_DIR = join(homedir(), ".cache", "claude-md-coach");
const PENDING_PATH = join(CACHE_DIR, "pending.json");
const HISTORY_DIR = join(CACHE_DIR, "history");
export function savePending(summary) {
    if (!existsSync(CACHE_DIR))
        mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(PENDING_PATH, JSON.stringify(summary, null, 2));
    if (!existsSync(HISTORY_DIR))
        mkdirSync(HISTORY_DIR, { recursive: true });
    const ts = summary.generatedAt.replace(/[:.]/g, "-");
    writeFileSync(join(HISTORY_DIR, `${ts}.json`), JSON.stringify(summary, null, 2));
}
export function loadPending() {
    if (!existsSync(PENDING_PATH))
        return null;
    try {
        return JSON.parse(readFileSync(PENDING_PATH, "utf8"));
    }
    catch {
        return null;
    }
}
export function formatPendingNudge(s) {
    const parts = [];
    if (s.totalDead > 0)
        parts.push(`${s.totalDead} rule${s.totalDead === 1 ? "" : "s"} with no trigger`);
    if (s.totalContradictions > 0)
        parts.push(`${s.totalContradictions} contradiction${s.totalContradictions === 1 ? "" : "s"}`);
    if (s.totalDrafts > 0)
        parts.push(`${s.totalDrafts} missing-rule suggestion${s.totalDrafts === 1 ? "" : "s"}`);
    if (parts.length === 0)
        return "";
    return `💡 claude-md-coach: ${parts.join(", ")} — run \`npx claude-md-coach fix\``;
}
export function runPending() {
    const s = loadPending();
    if (!s) {
        process.stdout.write("No cached analysis. Run `claude-md-coach scan` first.\n");
        return;
    }
    const nudge = formatPendingNudge(s);
    if (nudge)
        process.stdout.write(nudge + "\n");
    else
        process.stdout.write("No pending insights.\n");
}
//# sourceMappingURL=pending.js.map