# claude-md-coach

An ambient coach for your `CLAUDE.md` files. Reads your Claude Code chat history, finds dead rules, mines your corrections, and proposes smarter replacements — all locally, using your existing Claude subscription.

> **No API key. No server. No data collection.** Everything runs on your machine.

## Install

### From this marketplace (recommended)

Inside Claude Code:

```
/plugin marketplace add <github-user>/claude-md-coach
/plugin install claude-md-coach@claude-md-coach
```

*(replace `<github-user>` with the owner of the repo you cloned/forked from)*

### Local development / trying it without publishing

```bash
git clone https://github.com/<user>/claude-md-coach.git
claude --plugin-dir ./claude-md-coach
```

### Uninstall

```
/plugin uninstall claude-md-coach
```

## What happens after install

The plugin runs in the background. You never type another command.

- **Mid-chat**: when Claude notices you've corrected the same thing 3+ times in a session, Claude pauses and offers to add a rule to your CLAUDE.md.
- **Session start**: if pending insights accumulated from previous sessions, you see a one-line nudge.
- **Session end**: silent re-scan updates the cache in the background.

## Why this exists

Research (and [Anthropic's own docs](https://code.claude.com/docs/en/best-practices)) show that as a `CLAUDE.md` file grows past ~150 lines, Claude starts ignoring rules. A $200/mo Max user ran [their own A/B test](https://github.com/anthropics/claude-code/issues/34358): advisory rules violated **~100%** of the time; the same rules backed by a hook violated **0%**.

Your `CLAUDE.md` rots in two directions:
- Rules you **wrote but Claude ignores** (dead weight)
- Rules you **never wrote but should have** (patterns you keep correcting manually)

This tool fixes both — using your own session history as the source of truth.

## What the tool does

1. **Finds dead rules** — rules whose triggers never appear in your sessions
2. **Flags contradictions** — rule pairs that tell Claude opposite things
3. **Mines your corrections** — patterns you fix 3+ times become rule candidates
4. **Drafts in your voice** — new rules match your existing style

## Manual CLI (optional power-user backup)

After installation the `claude-md-coach` command is on your PATH. You never need it for the ambient experience, but if you want to dig in:

```bash
claude-md-coach scan                    # deterministic audit report
claude-md-coach fix                     # interactive review using your Claude subscription
claude-md-coach distill                 # one-shot section compression
claude-md-coach distill --progressive   # iterative compress-until-behavior-diverges
claude-md-coach distill --verify        # replay past sessions to confirm compressed behavior
claude-md-coach history                 # trends from recent scans
claude-md-coach pending                 # cached nudge (used by the SessionStart hook)
```

## Developing this plugin locally

```bash
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
skills/
  claude-md-coach/
    SKILL.md               ambient coaching prompt
hooks/
  hooks.json               SessionStart + SessionEnd registration
bin/
  claude-md-coach          CLI shim (bash)
src/
  cli.ts                   command entry
  parsers/                 CLAUDE.md + session JSONL parsers
  analyzers/               dead rules, contradictions, corrections, sprawl, cross-file
  commands/                scan / fix / pending
  llm/runner.ts            `claude -p` subprocess wrapper + caching
  report/format.ts         terminal output
dist/                      compiled output (shipped with plugin)
```

## Honest limitations

- Dead-rule detection uses keyword matching. Advisory rules like *"Demand elegance"* don't leave mechanical traces even when they're working. The tool labels these as *"either dead, or purely advisory — deterministic detection can't see them."*
- LLM features spawn `claude -p` subprocesses. On Max plan, this counts against rate limits. The tool caches and batches aggressively. A typical `fix` run costs 3–10 Claude calls.
- Correction mining needs explicit corrections in your session history (messages starting with "no", "don't", "actually", etc.). Silent edit-and-move-on users produce less signal.

## License

MIT
