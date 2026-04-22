import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { withSpinner } from "../ui/spinner.js";

export type Model = "haiku" | "sonnet" | "opus";

export interface RunOptions {
  model?: Model;
  systemPrompt?: string;
  timeoutMs?: number;
  useCache?: boolean;
}

export interface RunResult {
  text: string;
  cached: boolean;
  error?: string;
}

const CACHE_DIR = join(homedir(), ".cache", "claude-md-coach");

export class ClaudeRunner {
  private cacheDir: string;

  constructor(cacheDir = CACHE_DIR) {
    this.cacheDir = cacheDir;
    if (!existsSync(this.cacheDir)) {
      mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  async run(prompt: string, opts: RunOptions = {}): Promise<RunResult> {
    const model = opts.model ?? "haiku";
    const cacheKey = this.keyFor(prompt, model, opts.systemPrompt);
    const cachePath = join(this.cacheDir, `${cacheKey}.json`);

    if (opts.useCache !== false && existsSync(cachePath)) {
      try {
        const data = JSON.parse(readFileSync(cachePath, "utf8"));
        return { text: data.text, cached: true };
      } catch {}
    }

    const result = await withSpinner(
      `Calling Claude (${model})`,
      () => this.invoke(prompt, model, opts.systemPrompt, opts.timeoutMs ?? 90000),
    );

    if (opts.useCache !== false && !result.error) {
      try {
        writeFileSync(cachePath, JSON.stringify({ text: result.text, ts: Date.now() }));
      } catch {}
    }

    return result;
  }

  async runJson<T>(prompt: string, opts: RunOptions = {}): Promise<T | null> {
    const result = await this.run(prompt, opts);
    if (result.error) return null;
    return extractJson<T>(result.text);
  }

  private keyFor(prompt: string, model: string, systemPrompt?: string): string {
    const h = createHash("sha256");
    h.update(model + "\n" + (systemPrompt ?? "") + "\n" + prompt);
    return h.digest("hex").slice(0, 24);
  }

  private invoke(
    prompt: string,
    model: Model,
    systemPrompt: string | undefined,
    timeoutMs: number,
  ): Promise<RunResult> {
    return new Promise(resolve => {
      const args = [
        "-p",
        "--model", model,
        "--output-format", "text",
        "--no-session-persistence",
        "--disable-slash-commands",
      ];
      if (systemPrompt) {
        args.push("--append-system-prompt", systemPrompt);
      }

      const child = spawn("claude", args, { stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      let done = false;

      const finish = (r: RunResult) => {
        if (done) return;
        done = true;
        resolve(r);
      };

      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        finish({ text: "", cached: false, error: `timeout after ${timeoutMs}ms` });
      }, timeoutMs);

      child.stdout.on("data", d => (stdout += d.toString()));
      child.stderr.on("data", d => (stderr += d.toString()));

      child.on("error", err => {
        clearTimeout(timer);
        finish({ text: "", cached: false, error: err.message });
      });

      child.on("close", code => {
        clearTimeout(timer);
        if (code !== 0) {
          finish({ text: stdout, cached: false, error: `exit ${code}: ${stderr.slice(0, 300)}` });
        } else {
          finish({ text: stdout.trim(), cached: false });
        }
      });

      child.stdin.write(prompt);
      child.stdin.end();
    });
  }

  async checkAvailable(): Promise<boolean> {
    return new Promise(resolve => {
      const child = spawn("claude", ["--version"], { stdio: "pipe" });
      child.on("close", code => resolve(code === 0));
      child.on("error", () => resolve(false));
    });
  }
}

export function extractJson<T>(text: string): T | null {
  const fenced = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  const candidates: string[] = [];
  if (fenced) candidates.push(fenced[1].trim());
  candidates.push(text.trim());

  for (const c of candidates) {
    const parsed = tryParseJsonBlock<T>(c);
    if (parsed !== null) return parsed;
  }
  return null;
}

function tryParseJsonBlock<T>(text: string): T | null {
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch !== "{" && ch !== "[") continue;
    const end = findMatchingClose(text, i);
    if (end < 0) continue;
    const slice = text.slice(i, end + 1);
    try {
      return JSON.parse(slice) as T;
    } catch {}
  }
  return null;
}

function findMatchingClose(s: string, start: number): number {
  const open = s[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (escape) { escape = false; continue; }
    if (c === "\\" && inString) { escape = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}
