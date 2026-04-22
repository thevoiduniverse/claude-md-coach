import { readFileSync } from "node:fs";
import type { ClaudeMdFile, Rule, Section, FileScope } from "../types.js";

const STOP_WORDS = new Set([
  "a","an","the","and","or","but","is","are","was","were","be","been","being",
  "of","in","to","for","with","on","at","by","from","as","it","its","this",
  "that","these","those","you","your","we","our","i","my","me","not","no",
  "do","does","did","don","dont","will","would","should","could","can","cant",
  "if","when","then","than","so","also","too","just","only","any","all","each",
  "every","some","one","two","three","first","last","next","before","after",
  "has","have","had","use","used","using","make","made","get","got","new",
]);

export function parseClaudeMd(path: string, scope: FileScope, projectName?: string): ClaudeMdFile {
  const content = readFileSync(path, "utf8");
  const lines = content.split("\n");
  const sections: Section[] = [];
  const rules: Rule[] = [];
  const imports: string[] = [];

  let currentSection: string | undefined;
  let sectionStartLine = 0;
  let ruleCounter = 0;

  let currentParagraph: string[] = [];
  let paragraphStart = 0;

  const flushParagraph = () => {
    if (currentParagraph.length === 0) return;
    const text = currentParagraph.join(" ").trim();
    if (text.length > 20 && !text.startsWith("#")) {
      ruleCounter++;
      rules.push({
        id: `R${ruleCounter}`,
        text,
        section: currentSection,
        startLine: paragraphStart,
        endLine: paragraphStart + currentParagraph.length - 1,
        kind: "paragraph",
        keywords: extractKeywords(text),
      });
    }
    currentParagraph = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trimEnd();

    if (line.startsWith("@")) {
      const match = line.match(/^@(\S+)/);
      if (match) imports.push(match[1]);
    }

    const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headerMatch) {
      flushParagraph();
      if (sections.length > 0) {
        sections[sections.length - 1].endLine = i - 1;
      }
      currentSection = headerMatch[2].trim();
      sectionStartLine = i;
      sections.push({
        title: currentSection,
        startLine: i,
        endLine: lines.length - 1,
        level: headerMatch[1].length,
      });
      continue;
    }

    const bulletMatch = line.match(/^\s*[-*]\s+(.+)$/);
    const numberedMatch = line.match(/^\s*\d+\.\s+(.+)$/);

    if (bulletMatch || numberedMatch) {
      flushParagraph();
      const text = (bulletMatch?.[1] ?? numberedMatch?.[1] ?? "").trim();
      if (text.length === 0) continue;
      ruleCounter++;
      rules.push({
        id: `R${ruleCounter}`,
        text,
        section: currentSection,
        startLine: i,
        endLine: i,
        kind: bulletMatch ? "bullet" : "numbered",
        keywords: extractKeywords(text),
      });
      continue;
    }

    if (line.trim().length === 0) {
      flushParagraph();
      continue;
    }

    if (currentParagraph.length === 0) paragraphStart = i;
    currentParagraph.push(line.trim());
  }
  flushParagraph();
  if (sections.length > 0) sections[sections.length - 1].endLine = lines.length - 1;

  const stat = content.length;
  return {
    path,
    scope,
    projectName,
    lines: lines.length,
    bytes: stat,
    rules,
    sections,
    imports,
  };
}

function extractKeywords(text: string): string[] {
  const lower = text.toLowerCase();
  const tokens = lower.match(/[a-z][a-z0-9\-_/.]*[a-z0-9]|[a-z]/g) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tokens) {
    if (t.length < 3) continue;
    if (STOP_WORDS.has(t)) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}
