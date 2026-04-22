import { dirname } from "node:path";
export function sessionsForFile(file, sessions) {
    if (file.scope === "global")
        return sessions;
    const fileDir = dirname(file.path);
    return sessions.filter(s => {
        const cwd = s.projectKey;
        if (!cwd)
            return false;
        return cwd === fileDir || cwd.startsWith(fileDir + "/");
    });
}
//# sourceMappingURL=scope.js.map