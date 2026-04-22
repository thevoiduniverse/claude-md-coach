import { createReadStream } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { createInterface } from "node:readline";
export async function listSessionFiles() {
    const root = join(homedir(), ".claude", "projects");
    const out = [];
    let projectDirs;
    try {
        projectDirs = await readdir(root, { withFileTypes: true });
    }
    catch {
        return out;
    }
    for (const d of projectDirs) {
        if (!d.isDirectory())
            continue;
        const projectPath = join(root, d.name);
        let files;
        try {
            files = await readdir(projectPath);
        }
        catch {
            continue;
        }
        for (const f of files) {
            if (f.endsWith(".jsonl"))
                out.push(join(projectPath, f));
        }
    }
    return out;
}
export async function parseSession(filePath) {
    const events = [];
    const toolCounts = {};
    const filesTouched = new Set();
    let sessionId = "";
    let projectKey = "";
    let startedAt = "";
    let endedAt = "";
    let userMessageCount = 0;
    let cwd = "";
    const stream = createReadStream(filePath, { encoding: "utf8" });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of rl) {
        if (!line.trim())
            continue;
        let obj;
        try {
            obj = JSON.parse(line);
        }
        catch {
            continue;
        }
        if (obj.sessionId && !sessionId)
            sessionId = obj.sessionId;
        if (obj.cwd && !cwd)
            cwd = obj.cwd;
        if (obj.timestamp) {
            if (!startedAt)
                startedAt = obj.timestamp;
            endedAt = obj.timestamp;
        }
        const type = obj.type;
        if (type === "user") {
            const msg = obj.message;
            if (msg && typeof msg.content === "string") {
                const content = msg.content;
                if (!content.startsWith("<") && content.trim().length > 0) {
                    userMessageCount++;
                    events.push({
                        sessionId: obj.sessionId,
                        timestamp: obj.timestamp,
                        type: "user_message",
                        content,
                    });
                }
            }
        }
        else if (type === "assistant") {
            const msg = obj.message;
            if (!msg || !Array.isArray(msg.content))
                continue;
            for (const block of msg.content) {
                if (!block || typeof block !== "object")
                    continue;
                if (block.type === "thinking" && typeof block.thinking === "string") {
                    events.push({
                        sessionId: obj.sessionId,
                        timestamp: obj.timestamp,
                        type: "thinking",
                        content: block.thinking,
                    });
                }
                else if (block.type === "text" && typeof block.text === "string") {
                    events.push({
                        sessionId: obj.sessionId,
                        timestamp: obj.timestamp,
                        type: "assistant_text",
                        content: block.text,
                    });
                }
                else if (block.type === "tool_use") {
                    const name = String(block.name ?? "unknown");
                    toolCounts[name] = (toolCounts[name] ?? 0) + 1;
                    const input = block.input ?? {};
                    let filePathVal;
                    const fp = input["file_path"];
                    if (["Read", "Write", "Edit"].includes(name) && typeof fp === "string") {
                        filePathVal = fp;
                        filesTouched.add(fp);
                    }
                    const cmd = input["command"];
                    const inputSnippet = name === "Bash" && typeof cmd === "string"
                        ? cmd.slice(0, 500)
                        : "";
                    events.push({
                        sessionId: obj.sessionId,
                        timestamp: obj.timestamp,
                        type: "tool_use",
                        content: inputSnippet,
                        toolName: name,
                        toolInput: input,
                        filePath: filePathVal,
                    });
                }
            }
        }
    }
    if (!sessionId)
        return null;
    projectKey = deriveProjectKey(cwd, filePath);
    return {
        sessionId,
        projectKey,
        startedAt,
        endedAt,
        events,
        toolCounts,
        userMessageCount,
        filesTouched: Array.from(filesTouched),
    };
}
function deriveProjectKey(cwd, filePath) {
    if (cwd)
        return cwd;
    const m = filePath.match(/projects\/([^/]+)\//);
    return m ? m[1] : "";
}
//# sourceMappingURL=session-parser.js.map