export function pickDistillCandidates(file) {
    const lines = file.rules.length === 0 ? [] : file.rules;
    const bySection = new Map();
    for (const r of lines) {
        const key = r.section ?? "__root__";
        bySection.set(key, (bySection.get(key) ?? 0) + 1);
    }
    const raw = file.path;
    const content = (() => {
        try {
            return require("node:fs").readFileSync(raw, "utf8");
        }
        catch {
            return "";
        }
    })();
    const allLines = content.split("\n");
    const candidates = [];
    for (const section of file.sections) {
        const ruleCount = bySection.get(section.title) ?? 0;
        if (ruleCount < 2)
            continue;
        const startLine = section.startLine;
        const endLine = section.endLine;
        const sectionLines = endLine - startLine + 1;
        if (sectionLines < 8)
            continue;
        candidates.push({
            section,
            originalText: allLines.slice(startLine, endLine + 1).join("\n"),
            originalLines: sectionLines,
            ruleCount,
        });
    }
    candidates.sort((a, b) => b.originalLines - a.originalLines);
    return candidates;
}
export async function distillSection(candidate, runner) {
    const prompt = `You are compressing a section of a developer's CLAUDE.md file. The goal: preserve ALL meaning and behavior while reducing line count by 30-60%.

RULES FOR COMPRESSION:
- Merge overlapping rules into one.
- Keep every distinct constraint, tool reference, and behavioral directive.
- Prefer imperative one-liners ("Always X" / "Never Y" / "Prefer Z when W").
- Keep the section heading unchanged.
- Output ONLY the compressed section (heading + rules), no preamble, no explanation.

ORIGINAL SECTION:
${candidate.originalText}

Output the compressed version:`;
    const result = await runner.run(prompt, { model: "haiku" });
    if (result.error || !result.text.trim())
        return null;
    const compressed = result.text.trim();
    const compressedLines = compressed.split("\n").length;
    return {
        candidate,
        compressed,
        compressedLines,
        reductionPct: Math.round(((candidate.originalLines - compressedLines) / candidate.originalLines) * 100),
    };
}
export async function verifyReplay(candidate, compressedSection, sessions, runner, sampleSize = 3) {
    const picked = pickReplaySessions(sessions, sampleSize);
    const replays = [];
    for (const s of picked) {
        const userPrompt = firstSubstantiveUserPrompt(s);
        if (!userPrompt)
            continue;
        const responseA = await runner.run(`User's first prompt in a coding session: "${userPrompt.slice(0, 800)}"\n\nGive your initial response plan (2-4 sentences, no code yet). Focus on what you'd do first.`, { model: "haiku", systemPrompt: candidate.originalText });
        const responseB = await runner.run(`User's first prompt in a coding session: "${userPrompt.slice(0, 800)}"\n\nGive your initial response plan (2-4 sentences, no code yet). Focus on what you'd do first.`, { model: "haiku", systemPrompt: compressedSection });
        if (responseA.error || responseB.error)
            continue;
        const scoring = await scoreSimilarity(responseA.text, responseB.text, runner);
        replays.push({
            sessionId: s.sessionId,
            userPrompt: userPrompt.slice(0, 200),
            responseA: responseA.text.slice(0, 400),
            responseB: responseB.text.slice(0, 400),
            similarity: scoring.similarity,
            notes: scoring.notes,
        });
    }
    const avg = replays.length === 0 ? 0 : Math.round(replays.reduce((a, r) => a + r.similarity, 0) / replays.length);
    return {
        avgSimilarity: avg,
        replays,
        verdict: avg >= 80 ? "safe" : "risky",
    };
}
async function scoreSimilarity(a, b, runner) {
    const prompt = `You are comparing two response plans from the same user prompt but with different system-prompt rules. Rate how behaviorally equivalent they are on a 0-100 scale.

100 = functionally identical intent and approach
80 = same approach, minor wording differences
60 = similar but noticeable divergence in priorities
40 = different approaches
0 = unrelated

Output JSON only: { "similarity": <0-100 integer>, "notes": "<one short sentence>" }

RESPONSE A:
${a.slice(0, 1500)}

RESPONSE B:
${b.slice(0, 1500)}`;
    const r = await runner.runJson(prompt, { model: "haiku" });
    if (!r || typeof r.similarity !== "number")
        return { similarity: 0, notes: "scoring failed" };
    return { similarity: Math.max(0, Math.min(100, Math.round(r.similarity))), notes: r.notes ?? "" };
}
function pickReplaySessions(sessions, n) {
    const eligible = sessions.filter(s => s.userMessageCount >= 2);
    const sorted = [...eligible].sort((a, b) => (b.endedAt ?? "").localeCompare(a.endedAt ?? ""));
    const picked = [];
    const seenToolKeys = new Set();
    for (const s of sorted) {
        const key = Object.keys(s.toolCounts).slice(0, 3).sort().join(",");
        if (!seenToolKeys.has(key) && picked.length < n) {
            picked.push(s);
            seenToolKeys.add(key);
        }
    }
    while (picked.length < n && picked.length < sorted.length)
        picked.push(sorted[picked.length]);
    return picked;
}
function firstSubstantiveUserPrompt(s) {
    for (const e of s.events) {
        if (e.type === "user_message" && e.content.trim().length > 30)
            return e.content;
    }
    return null;
}
export async function progressiveDistill(candidate, sessions, runner, opts = {}) {
    const maxIterations = opts.maxIterations ?? 4;
    const minSimilarity = opts.minSimilarity ?? 80;
    const sampleSize = opts.sampleSize ?? 3;
    const original = candidate.originalText;
    const originalLines = candidate.originalLines;
    let current = original;
    let currentLines = originalLines;
    const iterations = [];
    let stoppedReason = "max_iterations";
    for (let i = 0; i < maxIterations; i++) {
        const innerCandidate = {
            section: candidate.section,
            originalText: current,
            originalLines: currentLines,
            ruleCount: candidate.ruleCount,
        };
        const attempt = await distillSection(innerCandidate, runner);
        if (!attempt) {
            stoppedReason = "compression_failed";
            break;
        }
        if (attempt.compressedLines >= currentLines - 1) {
            stoppedReason = "no_reduction";
            break;
        }
        const driftCheck = {
            section: candidate.section,
            originalText: original,
            originalLines: originalLines,
            ruleCount: candidate.ruleCount,
        };
        const verify = await verifyReplay(driftCheck, attempt.compressed, sessions, runner, sampleSize);
        const accepted = verify.avgSimilarity >= minSimilarity;
        iterations.push({
            iteration: i + 1,
            beforeLines: currentLines,
            afterLines: attempt.compressedLines,
            similarity: verify.avgSimilarity,
            accepted,
            text: attempt.compressed,
        });
        if (!accepted) {
            stoppedReason = "verification_failed";
            break;
        }
        current = attempt.compressed;
        currentLines = attempt.compressedLines;
    }
    const reductionPct = Math.round(((originalLines - currentLines) / originalLines) * 100);
    return { finalText: current, finalLines: currentLines, reductionPct, iterations, stoppedReason };
}
//# sourceMappingURL=distill.js.map