import { readdir, access } from "node:fs/promises";
import { constants } from "node:fs";
import { join, relative, sep } from "node:path";
import { homedir } from "node:os";
const IGNORE_DIRS = new Set([
    "node_modules", ".git", "dist", "build", "out", ".next", ".nuxt",
    "coverage", ".cache", ".turbo", ".vercel", "vendor", "target",
    "backups", ".venv", "venv", "__pycache__", ".pytest_cache",
]);
const CLAUDE_MD_NAMES = new Set(["CLAUDE.md", "CLAUDE.local.md"]);
export async function discover(workspaceRoot) {
    const found = [];
    const globalPath = join(homedir(), ".claude", "CLAUDE.md");
    if (await exists(globalPath)) {
        found.push({ path: globalPath, scope: "global" });
    }
    await walk(workspaceRoot, workspaceRoot, found);
    return found;
}
async function exists(p) {
    try {
        await access(p, constants.R_OK);
        return true;
    }
    catch {
        return false;
    }
}
async function walk(dir, root, out) {
    let entries;
    try {
        entries = await readdir(dir, { withFileTypes: true });
    }
    catch {
        return;
    }
    for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
            if (IGNORE_DIRS.has(entry.name))
                continue;
            if (entry.name.startsWith(".") && entry.name !== ".claude")
                continue;
            await walk(full, root, out);
            continue;
        }
        if (!entry.isFile())
            continue;
        if (!CLAUDE_MD_NAMES.has(entry.name))
            continue;
        const rel = relative(root, full);
        const projectName = rel.split(sep)[0] || "root";
        out.push({
            path: full,
            scope: "project",
            projectName: projectName === entry.name ? "root" : projectName,
        });
    }
}
//# sourceMappingURL=discovery.js.map