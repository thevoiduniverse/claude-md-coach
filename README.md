# claude-md-coach

> **An ambient coach for your CLAUDE.md. Finds dead rules, mines your corrections, rewrites smarter. Runs locally, using your existing Claude subscription.**

**[claudemdcoach.com](https://claudemdcoach.com)** · [npm](https://www.npmjs.com/package/claude-md-coach) · [GitHub](https://github.com/thevoiduniverse/claude-md-coach)

[![npm version](https://img.shields.io/npm/v/claude-md-coach.svg?color=e8632d)](https://www.npmjs.com/package/claude-md-coach)
[![downloads](https://img.shields.io/npm/dw/claude-md-coach.svg?color=e8632d)](https://www.npmjs.com/package/claude-md-coach)
[![GitHub stars](https://img.shields.io/github/stars/thevoiduniverse/claude-md-coach?style=flat&color=e8632d)](https://github.com/thevoiduniverse/claude-md-coach)
[![license](https://img.shields.io/github/license/thevoiduniverse/claude-md-coach?color=e8632d)](./LICENSE)

Your `CLAUDE.md` is supposed to keep Claude on track. But after a few months of adding rules for every mistake, it grows past 300 lines, contradicts itself, and Claude starts ignoring most of it. **You don't notice, because the failure is silent.**

`claude-md-coach` is a Claude Code plugin that watches how you actually work, finds the rules Claude never follows, drafts the rules you forgot to write, and quietly keeps your `CLAUDE.md` sharp. You install it once. It runs in the background. You approve the rules it surfaces.

## Install

Inside Claude Code:

```
/plugin marketplace add thevoiduniverse/claude-md-coach
/plugin install claude-md-coach@claude-md-coach
```

That's the entire setup. You never type another command unless you want to.

## How it works · 3 steps

**1. Install once.** The plugin auto-registers a skill and two hooks (SessionStart, SessionEnd). Zero config files touched.

**2. Use Claude normally.** After every session ends, the tool silently scans your chat for correction patterns and rule misfires. Nothing interrupts you.

**3. Approve what you want.** When Claude notices you've corrected the same thing 3+ times, it pauses mid-chat and offers a rule in your voice. One click to add it.

> **No API key. No server. No data leaves your machine.**

## Why this exists

If you use Claude Code seriously, your `CLAUDE.md` has probably drifted. You wrote rules. Claude ignores many of them. You correct the same mistake over and over. It feels like Claude isn't listening, and you don't know which rules are actually working.

You're not imagining it. The research is clear:

- **[AGENTIF (Tsinghua, NeurIPS 2025)](https://arxiv.org/abs/2505.16944)** · Models follow under 30% of instructions perfectly in agentic tasks with typical rule counts.
- **[Lost in the Middle (Liu et al.)](https://arxiv.org/abs/2307.03172)** · Instructions buried mid-prompt get retrieved 20 percentage points less accurately.
- **[Claude Code issue #34358](https://github.com/anthropics/claude-code/issues/34358)** · A $200/mo Max user ran their own A/B test. Advisory rules violated ~100% of the time. Same rules with hook enforcement: 0%.
- **[Anthropic's own docs](https://code.claude.com/docs/en/best-practices)** · *"Performance degrades as [the context] fills."*

Your `CLAUDE.md` rots in two directions at once: rules you wrote that Claude ignores, and rules you never wrote but should have. This tool fixes both, using your own session history as the source of truth.

## What changes after install

- **Mid-chat** · When Claude spots a repeated correction pattern, it pauses and offers a rule in your voice. You approve with one click.
- **Session start** · If pending insights accumulated from previous sessions, you see a one-line nudge.
- **Session end** · Silent re-scan updates the local cache. No network calls.
- **Every week** · Your `CLAUDE.md` trends toward lean and effective without manual cleanup.

## Manual CLI (for power users)

The `claude-md-coach` command is on your PATH after install. You never need it for the ambient experience, but if you want to dig in:

```bash
claude-md-coach scan                    # deterministic audit report
claude-md-coach fix                     # interactive review using your Claude subscription
claude-md-coach distill                 # one-shot section compression
claude-md-coach distill --progressive   # iterative compress until behavior diverges
claude-md-coach distill --verify        # replay past sessions to confirm compressed behavior
claude-md-coach history                 # trends from recent scans
claude-md-coach pending                 # cached nudge (used by the SessionStart hook)
```

## Install methods

**Claude Code plugin (full ambient experience):**

```
/plugin marketplace add thevoiduniverse/claude-md-coach
/plugin install claude-md-coach@claude-md-coach
```

**npm (CLI only):**

```bash
npm install -g claude-md-coach
```

**No install (quick scan):**

```bash
npx claude-md-coach scan
```

## Uninstall

```
/plugin uninstall claude-md-coach
```

Nothing lingers on your system beyond a cache at `~/.cache/claude-md-coach/`, which you can delete any time.

## Local development

```bash
git clone https://github.com/thevoiduniverse/claude-md-coach.git
cd claude-md-coach
npm install
npx tsc
claude --plugin-dir ./
```

The `--plugin-dir` flag loads this repo as a plugin for the current Claude Code session only, without installing globally.

## Architecture

```
.claude-plugin/
  plugin.json              plugin manifest
  marketplace.json         marketplace entry
skills/
  claude-md-coach/
    SKILL.md               ambient coaching prompt
hooks/
  hooks.json               SessionStart + SessionEnd registration
bin/
  claude-md-coach          CLI shim
src/
  cli.ts                   command entry
  parsers/                 CLAUDE.md + session JSONL parsers
  analyzers/               dead rules, contradictions, corrections, sprawl, cross-file, distill, attribution
  commands/                scan / fix / distill / history / pending
  llm/runner.ts            `claude -p` subprocess wrapper + caching
  report/format.ts         terminal output
dist/                      compiled output (shipped with plugin)
```

## Honest limitations

- Dead-rule detection uses keyword matching in the deterministic pass. Advisory rules like *"Demand elegance"* don't leave mechanical traces even when they're working. The LLM verification step filters these out, but deep semantic coverage still has gaps.
- LLM features spawn `claude -p` subprocesses. On a Max plan, this counts against rate limits. The tool caches and batches aggressively. A typical `fix` run costs 3 to 10 Claude calls.
- Correction mining needs explicit corrections in your session history (messages starting with *"no"*, *"don't"*, *"actually"*, etc.). Silent edit-and-move-on users produce less signal.

## The cost of skipping this

If you don't fix your `CLAUDE.md`, it keeps growing. Claude keeps ignoring rules silently. You re-explain the same preferences in every new chat. Six months from now, your file is 500 lines and Claude feels broken. It isn't broken. It's buried.

## License

MIT
