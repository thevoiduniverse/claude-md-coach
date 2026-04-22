export async function detectContradictions(file, runner) {
    const rules = file.rules;
    if (rules.length < 2)
        return [];
    const candidates = prefilterPairs(rules);
    if (candidates.length === 0)
        return [];
    const batch = candidates.slice(0, 30);
    const numbered = batch
        .map(([a, b], i) => `[${i}] A (${a.id}): ${a.text}\n    B (${b.id}): ${b.text}`)
        .join("\n\n");
    const prompt = `You are reviewing a developer's CLAUDE.md rules for contradictions. Below are candidate pairs that may conflict. For each pair, decide:

- "conflict": true if the rules tell Claude to do genuinely opposing things in the same situation, false otherwise
- "severity": "hard" if the pair is impossible to satisfy together, "soft" if they create tension requiring judgment
- "explanation": one sentence on what the conflict actually is (or why not)
- "unified": one-sentence rewrite that preserves the intent of both rules (only if conflict=true)

Be conservative. Two rules about different topics are NOT conflicts. Two rules with different emphasis are NOT conflicts. Only flag pairs that directly oppose each other.

Output a JSON array with one entry per pair (index matches input index):

${numbered}

Respond with JSON only.`;
    const result = await runner.runJson(prompt, { model: "haiku" });
    if (!result || !Array.isArray(result))
        return [];
    const out = [];
    for (let i = 0; i < result.length; i++) {
        const r = result[i];
        if (!r || !r.conflict)
            continue;
        const idx = typeof r.index === "number" ? r.index : i;
        if (idx < 0 || idx >= batch.length)
            continue;
        const [a, b] = batch[idx];
        out.push({
            ruleA: a,
            ruleB: b,
            explanation: r.explanation ?? "",
            unified: r.unified ?? "",
            severity: r.severity ?? "soft",
        });
    }
    return out;
}
const OPPOSING_PAIRS = [
    ["always", "never"],
    ["keep", "remove"],
    ["keep", "delete"],
    ["prefer", "avoid"],
    ["do", "don't"],
    ["do", "do not"],
    ["use", "avoid"],
    ["use", "don't use"],
    ["concise", "verbose"],
    ["concise", "extensive"],
    ["concise", "detailed"],
    ["short", "long"],
    ["brief", "detailed"],
    ["minimal", "comprehensive"],
];
function hasOpposingTerms(a, b) {
    const aL = a.toLowerCase();
    const bL = b.toLowerCase();
    for (const [x, y] of OPPOSING_PAIRS) {
        if ((aL.includes(x) && bL.includes(y)) || (aL.includes(y) && bL.includes(x)))
            return true;
    }
    return false;
}
function prefilterPairs(rules) {
    const scored = [];
    for (let i = 0; i < rules.length; i++) {
        for (let j = i + 1; j < rules.length; j++) {
            const a = rules[i];
            const b = rules[j];
            if (a.keywords.length < 2 || b.keywords.length < 2)
                continue;
            const overlap = jaccard(new Set(a.keywords), new Set(b.keywords));
            const opposing = hasOpposingTerms(a.text, b.text);
            let score = overlap;
            if (opposing)
                score += 0.5;
            if (score >= 0.1 || opposing) {
                scored.push({ pair: [a, b], score });
            }
        }
    }
    scored.sort((x, y) => y.score - x.score);
    return scored.slice(0, 40).map(s => s.pair);
}
function jaccard(a, b) {
    if (a.size === 0 && b.size === 0)
        return 0;
    let inter = 0;
    for (const x of a)
        if (b.has(x))
            inter++;
    const union = a.size + b.size - inter;
    return union === 0 ? 0 : inter / union;
}
//# sourceMappingURL=contradictions.js.map