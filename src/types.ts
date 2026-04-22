export type FileScope = "global" | "project";

export interface ClaudeMdFile {
  path: string;
  scope: FileScope;
  projectName?: string;
  lines: number;
  bytes: number;
  rules: Rule[];
  sections: Section[];
  imports: string[];
}

export interface Section {
  title: string;
  startLine: number;
  endLine: number;
  level: number;
}

export interface Rule {
  id: string;
  text: string;
  section?: string;
  startLine: number;
  endLine: number;
  kind: "bullet" | "numbered" | "paragraph";
  keywords: string[];
}

export interface SessionEvent {
  sessionId: string;
  timestamp: string;
  type: "user_message" | "tool_use" | "thinking" | "assistant_text";
  content: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  filePath?: string;
}

export interface Session {
  sessionId: string;
  projectKey: string;
  startedAt: string;
  endedAt: string;
  events: SessionEvent[];
  toolCounts: Record<string, number>;
  userMessageCount: number;
  filesTouched: string[];
}

export interface RuleTrigger {
  ruleId: string;
  sessionId: string;
  reason: string;
  confidence: "high" | "medium" | "low";
}

export interface ScanReport {
  files: ClaudeMdFile[];
  sessionsAnalyzed: number;
  perFileFindings: PerFileFinding[];
  crossFileFindings: CrossFileFinding[];
}

export interface PerFileFinding {
  filePath: string;
  neverTriggered: Rule[];
  weakSignal: Rule[];
  sprawl: SprawlReport;
  triggerCounts: Record<string, number>;
  sessionsInScope: number;
}

export interface CrossFileFinding {
  kind: "duplicate" | "scope_mismatch";
  rules: Rule[];
  files: string[];
  suggestion: string;
}

export interface SprawlReport {
  lines: number;
  ruleCount: number;
  avgRuleLength: number;
  status: "healthy" | "warning" | "bloated";
  recommendation: string;
}
