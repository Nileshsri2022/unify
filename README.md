# unify

One manager for your local AI coding-agent stack.

You run Claude Code, Cursor, Codex, Gemini CLI and friends. `unify` keeps their
config (skills, MCP, rules, hooks, plugins) **and** their memory in sync — one
command, one status, one doctor.

unify is a thin **control plane**: it composes best-of-slice backends
([skillshare](https://github.com/runkids/skillshare) for config distribution,
[agentmemory](https://github.com/rohitg00/agentmemory) for persistent memory)
instead of re-implementing them.

## Stack

- Bun + TypeScript (strict) monorepo — `bun` workspaces
- CLI: citty, compiled to a single static binary
- Core: zod-validated `unify.yaml` config, `~/.unify` state
- Dashboard: React + Vite + Tailwind v4 + shadcn/ui (local, served by `unify ui`)

## Quickstart (dev)

```bash
bun install
bun test                 # unit tests (packages/core, apps/cli)
bun run build:cli        # → apps/cli/dist/unify
./apps/cli/dist/unify version
```

Dashboard (mock data until the real API lands):

```bash
bun run dev:dashboard    # → http://localhost:5173
```

## Commands

```
unify init [--yes] [--skip-install]   detect AI tools, install pinned skillshare,
                                      write unify.yaml, first sync
unify status [--json]                 backend health + per-target sync matrix
unify sync [--dry-run] [--target t]   sync skills to targets
unify doctor                          backend health + config issues
unify version                         print version
```

State lives in `~/.unify` (override with `$UNIFY_HOME`). The skillshare binary
is pinned + SHA256-verified under `~/.unify/backends/skillshare`.

## Layout

```
packages/core     shared types, config loader (zod), state paths
apps/cli          unify CLI (commands, adapters, dashboard server)
apps/dashboard    React dashboard (shadcn/ui)
docs/             DESIGN.md, PROGRESS.md, plans/
```

## Status

- [x] M0 — scaffold, core types, config loader, CLI skeleton
- [x] M1 — skillshare adapter (init / sync / status / doctor), pinned v0.28.0
- [ ] M2 — agentmemory adapter (MCP)
- [ ] M3 — profiles + glue workflows
- [ ] M4 — Stitch → shadcn dashboard refinement
- [ ] M5 — `unify ui` wiring + first release

See `docs/DESIGN.md` for the full design and `docs/PROGRESS.md` for stage status.
