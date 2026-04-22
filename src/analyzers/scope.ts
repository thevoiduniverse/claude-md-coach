import { dirname } from "node:path";
import type { ClaudeMdFile, Session } from "../types.js";

export function sessionsForFile(file: ClaudeMdFile, sessions: Session[]): Session[] {
  if (file.scope === "global") return sessions;
  const fileDir = dirname(file.path);
  return sessions.filter(s => {
    const cwd = s.projectKey;
    if (!cwd) return false;
    return cwd === fileDir || cwd.startsWith(fileDir + "/");
  });
}
