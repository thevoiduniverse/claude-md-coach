export async function classifyRuleAgainstSessions(rules, sessions, runner) {
    if (rules.length === 0 || sessions.length === 0)
        return [];
    const sampleSessions = pickRepresentative(sessions, 3);
    const sessionSummaries = sampleSessions
        .map((s, i) => `Session ${i + 1}:\n${summarize(s)}`)
        .join("\n\n---\n\n");
    const ruleList = rules.slice(0, 30).map(r => `${r.id}: ${r.text}`).join("\n");
    const prompt = `You are auditing a developer's CLAUDE.md rules against recent Claude Code sessions. For each rule, decide if it applied in any of these sessions, and if so whether it was followed.

Verdicts:
- "followed" — rule applied and Claude adhered to it
- "violated" — rule applied and Claude did not adhere
- "irrelevant" — rule didn't apply to any of these sessions (topic didn't come up)
- "unclear" — can't tell from evidence

Be honest. If the rule is about something these sessions didn't cover, say "irrelevant" — don't guess.

RULES:
${ruleList}

SESSIONS (each is a compact summary of user prompts + tool usage):
${sessionSummaries}

Output a JSON array with one object per rule: { "ruleId": "R#", "verdict": "...", "reason": "one short sentence" }. JSON only.`;
    const result = await runner.runJson(prompt, { model: "haiku" });
    if (!result || !Array.isArray(result))
        return [];
    return result.filter(v => v && typeof v.ruleId === "string");
}
function pickRepresentative(sessions, n) {
    const sorted = [...sessions].sort((a, b) => (b.endedAt ?? "").localeCompare(a.endedAt ?? ""));
    const picked = [];
    const seenTools = new Set();
    for (const s of sorted) {
        const key = Object.keys(s.toolCounts).sort().join(",");
        if (picked.length < n && !seenTools.has(key)) {
            picked.push(s);
            seenTools.add(key);
        }
    }
    while (picked.length < n && picked.length < sorted.length) {
        picked.push(sorted[picked.length]);
    }
    return picked;
}
function summarize(s) {
    const parts = [];
    const tools = Object.entries(s.toolCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([k, v]) => `${k}×${v}`)
        .join(", ");
    parts.push(`Tools used: ${tools}`);
    const userMsgs = s.events
        .filter(e => e.type === "user_message")
        .slice(0, 4)
        .map(e => `> ${e.content.slice(0, 180)}`);
    if (userMsgs.length)
        parts.push("User messages:\n" + userMsgs.join("\n"));
    const files = s.filesTouched.slice(0, 5).join(", ");
    if (files)
        parts.push(`Files touched: ${files}`);
    return parts.join("\n");
}
//# sourceMappingURL=semantic-trigger.js.map