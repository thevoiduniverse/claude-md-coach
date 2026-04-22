import { analyzeDeadRules } from "./dead-rules.js";
const CONCENTRATION_THRESHOLD = 0.7;
const MIN_HITS_FOR_SUGGESTION = 3;
export function analyzeScopeMove(file, sessions) {
    if (file.scope !== "global")
        return [];
    if (sessions.length === 0)
        return [];
    const analysis = analyzeDeadRules(file, sessions);
    const byRule = new Map();
    for (const rule of file.rules)
        byRule.set(rule.id, { rule, sessionsHit: [] });
    for (const stats of analysis.perRule) {
        const entry = byRule.get(stats.ruleId);
        if (entry)
            entry.sessionsHit = stats.sessionsHit;
    }
    const sessionByProject = new Map();
    for (const s of sessions) {
        const key = topLevelProject(s.projectKey);
        sessionByProject.set(s.sessionId, key);
    }
    const suggestions = [];
    for (const { rule, sessionsHit } of byRule.values()) {
        if (sessionsHit.length < MIN_HITS_FOR_SUGGESTION)
            continue;
        const counts = new Map();
        for (const sid of sessionsHit) {
            const key = sessionByProject.get(sid);
            if (!key)
                continue;
            counts.set(key, (counts.get(key) ?? 0) + 1);
        }
        let topProject = "";
        let topCount = 0;
        for (const [k, v] of counts) {
            if (v > topCount) {
                topCount = v;
                topProject = k;
            }
        }
        const concentration = topCount / sessionsHit.length;
        if (concentration >= CONCENTRATION_THRESHOLD && topProject) {
            suggestions.push({
                rule,
                fromFile: file.path,
                suggestedProjectKey: topProject,
                concentration,
                hitCount: topCount,
                totalHits: sessionsHit.length,
            });
        }
    }
    return suggestions;
}
function topLevelProject(cwd) {
    if (!cwd)
        return "";
    const parts = cwd.split("/").filter(Boolean);
    const idx = parts.indexOf("Claude code");
    if (idx >= 0 && idx + 1 < parts.length)
        return parts[idx + 1];
    return parts[parts.length - 1] ?? "";
}
//# sourceMappingURL=scope-move.js.map