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

Clean machine (install Bun/Node, `init`, dashboard) step by step:
**[docs/SETUP.md](docs/SETUP.md)**.

```bash
bun install
bun test                 # unit tests (core, cli, dashboard lib helpers)
bun run build:cli        # → apps/cli/dist/unify
./apps/cli/dist/unify version
```

Dashboard (live data — served with its JSON API on one local port):

```bash
./apps/cli/dist/unify ui              # → http://127.0.0.1:7420 (dashboard + /api)
```

Dev workflow (hot reload + API-only backend):

```bash
./apps/cli/dist/unify ui --api-only   # JSON API only on :7420
bun run dev:dashboard                 # vite dev on :5173, proxies /api → :7420
```

## Commands

```
unify init [--yes] [--skip-install]   detect AI tools, install pinned skillshare,
                                      write unify.yaml, first sync
unify status [--json]                 backend health + per-target sync matrix
unify sync [--dry-run] [--target t]   sync skills to targets
unify doctor                          backend health + config issues
unify memory save <text> [--concepts a,b]
                                      memory recall <query> [--limit n]
unify profile [name]                  show active profile, or switch (work/personal)
unify ui [--port n] [--host h] [--api-only]
                                      serve dashboard + JSON API (loopback by default)
unify version                         print version
```

State lives in `~/.unify` (override with `$UNIFY_HOME`). The skillshare binary
is pinned + SHA256-verified under `~/.unify/backends/skillshare`.

## Dashboard & JSON API

`unify ui` serves the dashboard **and** its JSON API on one 127.0.0.1 port
(default 7420, `$UNIFY_UI_PORT` / `--port`). The UI and CLI share the same
orchestrator, so what you see is what the CLI reports.

The bind interface is loopback by default — the dashboard has no auth. Inside a
container / remote sandbox, opt in explicitly with `--host 0.0.0.0` (or
`$UNIFY_UI_HOST`).

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/api/status` | GET | backends, targets, memory, lastSync |
| `/api/doctor` | GET | cross-backend issues |
| `/api/profiles` | GET / POST | list / switch active profile |
| `/api/memory` | GET `?q=&limit=&profile=` | scoped recall (profile override for tabs) |
| `/api/memory` | POST `{text, concepts?}` | save to active profile |
| `/api/sync` | POST `{dryRun, target?}` | dry-run / apply (+ glue lines) |

Profile memory is isolated end-to-end: each profile is an agentmemory
`agentId` namespace, so work recall never surfaces personal memories and
vice-versa. If the API is unreachable the dashboard falls back to demo data
with a visible banner — never silently — and the banner names the real problem:
**API offline** (no server on the port) and **API error** (server up, request
failed, e.g. a backend that is not installed) are reported differently.

## Layout

```
packages/core     shared types, config loader (zod), state paths
apps/cli          unify CLI (commands, adapters, dashboard server)
apps/dashboard    React dashboard (shadcn/ui)
docs/             SETUP.md (initial setup), plans/
```

## Status

- [x] M0 — scaffold, core types, config loader, CLI skeleton
- [x] M1 — skillshare adapter (init / sync / status / doctor), pinned v0.28.0
- [x] M2 — agentmemory adapter (REST), pinned v0.9.31
- [x] M3 — profiles (work/personal) + post-sync glue
- [ ] M4 — Stitch → shadcn dashboard refinement (blocked on API key)
- [x] M5 — `unify ui` dashboard + JSON API, local-first
- [x] M6 — Windows support for backend install/launch (`skillshare.exe` zip assets, node-run agentmemory)

See `docs/DESIGN.md` for the full design and `docs/PROGRESS.md` for stage status.
