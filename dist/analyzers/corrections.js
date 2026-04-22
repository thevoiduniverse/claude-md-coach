const CORRECTION_TRIGGERS = [
    /\bno\s*,?\s*(don'?t|dont|stop|not|never|please)/i,
    /\bstop\s*(doing|using|that)/i,
    /\bdon'?t\s+/i,
    /\bnever\s+/i,
    /\bactually,?\s/i,
    /\byou('re|\s+are)\s+wrong\b/i,
    /\bwhy\s+(did|are)\s+you\b/i,
    /\bthat'?s\s+(wrong|not right|bad)/i,
    /\bi\s+(told|said|asked)\s+you/i,
    /\bi\s+(don'?t|do\s+not)\s+(want|like)/i,
    /\bplease\s+(don'?t|stop|fix|change)/i,
    /\bshould\s+(have|not)\s+/i,
];
export function extractCorrections(sessions) {
    const out = [];
    for (const s of sessions) {
        for (let i = 0; i < s.events.length; i++) {
            const e = s.events[i];
            if (e.type !== "user_message")
                continue;
            const text = e.content.trim();
            if (text.length < 3 || text.length > 2000)
                continue;
            if (!isCorrectionCandidate(text))
                continue;
            const prev = findPrecedingTool(s.events, i);
            out.push({
                sessionId: s.sessionId,
                timestamp: e.timestamp,
                text,
                precedingTool: prev?.toolName,
                precedingFilePath: prev?.filePath,
            });
        }
    }
    return out;
}
function isCorrectionCandidate(text) {
    if (text.length > 400)
        return false;
    for (const re of CORRECTION_TRIGGERS) {
        if (re.test(text))
            return true;
    }
    return false;
}
function findPrecedingTool(events, idx) {
    for (let j = idx - 1; j >= Math.max(0, idx - 5); j--) {
        if (events[j].type === "tool_use")
            return events[j];
    }
    return undefined;
}
export async function clusterCorrections(signals, runner) {
    if (signals.length === 0)
        return [];
    if (signals.length > 200)
        signals = signals.slice(-200);
    const numbered = signals.map((s, i) => `[${i}] ${s.text.slice(0, 300)}`).join("\n");
    const prompt = `You are analyzing a developer's corrections to Claude across many coding sessions. Each item below is a moment where they pushed back on what Claude was doing.

Group similar corrections into themes. For each theme, output a JSON object with:
- "theme": one-line summary of the recurring behavior being corrected
- "indices": array of input indices belonging to this theme
- "candidate_rule": a one-sentence CLAUDE.md rule (imperative voice, specific) that would prevent this class of correction
- "confidence": "high" if 4+ corrections in theme, "medium" if 2-3, "low" if just 1

Only output themes with 2+ corrections (skip one-offs). Keep themes tight and non-overlapping. Output a JSON array, nothing else.

CORRECTIONS:
${numbered}`;
    const result = await runner.runJson(prompt, { model: "haiku" });
    if (!result || !Array.isArray(result))
        return [];
    const clusters = [];
    for (const r of result) {
        const rawIndices = Array.isArray(r.indices) ? r.indices : [];
        const members = rawIndices
            .filter(i => typeof i === "number" && i >= 0 && i < signals.length)
            .map(i => signals[i]);
        if (members.length < 2)
            continue;
        clusters.push({
            theme: r.theme,
            signals: members,
            candidateRule: r.candidate_rule,
            confidence: r.confidence ?? "low",
        });
    }
    return clusters;
}
//# sourceMappingURL=corrections.js.map