# M2 — agentmemory Adapter Plan

Goal: `unify status` shows a memory summary; `unify memory save/recall` does a
real round-trip; `unify init` installs + starts the pinned agentmemory server.
Rules: thin control plane — drive agentmemory only through its CLI/REST; pin version; fixtures for every parsed response.

Pinned backend: **@agentmemory/agentmemory 0.9.31** (npm; Node 20+).

## Empirical contract (verified in sandbox 2026-10-30, v0.9.31)

- npm bin `agentmemory`; `agentmemory init` → `~/.agentmemory/.env` (keyless default, non-interactive)
- `agentmemory` (default cmd) = foreground supervisor: boots pinned iii-engine (auto-installed first run, v0.25.0), REST `127.0.0.1:3111`, viewer `:3113`. Non-interactive env auto-installs.
- `agentmemory stop` → stops engine+workers, **data preserved**. `agentmemory status` = human health table (Health/Sessions/Observations/Memories).
- REST, Bearer = `~/.agentmemory/secret`:
  - `GET /agentmemory/livez` (unauthenticated): `{"service":"agentmemory","status":"ok","viewerPort":3113}`
  - `GET /agentmemory/health`: `{"status":"healthy","version":"0.9.31",...}`
  - `GET /agentmemory/status`: `{"index":{"memoriesIndexed":N}, "capture":{...}}`
  - `POST /agentmemory/remember` `{content, concepts[]}` → `{"memory":{"id":"mem_..."},"success":true}`
  - `POST /agentmemory/smart-search` `{query, limit}` → `{"results":[{"obsId","score","title","type"}]}`
- Data: `~/.local/share/agentmemory/state_store.db/`; state: `~/.agentmemory/` (secret, engine-state.json, compose log)
- Options: `--port N`, `--instance N` (port 3111+N·100), `--data-dir`, `AGENTMEMORY_URL`

## Transport decision — REST, not MCP stdio (DEVIATION from DESIGN §4 wording)

The `@agentmemory/mcp` shim is a **thin proxy**: full 54-tool surface only when
a server is reachable via `AGENTMEMORY_URL`; otherwise a degraded 7-tool local
set. So "spawn MCP over stdio" still requires managing the same server. Once
the server is managed (mandatory either way), REST is the stable, documented,
curl-testable surface and needs no hand-rolled JSON-RPC framing. The design's
*intent* (adapters own the backend's interface; pinned lifecycle) is preserved.
MCP stdio remains a documented v2 option behind the same `MemoryClient` seam.

## Tasks

### M2-1 — Fixture capture + contract pin
- **Files:** `apps/cli/testdata/agentmemory/0.9.31/{livez.json,health.json,status.json,remember.json,smart-search.json,README.md}`
- **Spec:** capture from the real pinned server in an isolated HOME; README documents commands + re-record recipe (mirror skillshare's).
- **Verify:** files exist, valid JSON.

### M2-2 — REST client (TDD)
- **Files:** `apps/cli/src/adapters/agentmemory/client.ts`, `client.test.ts`
- **Spec:** `MemoryClient` interface `{livez(), health(), memoryCount(), save(content, concepts), recall(query, limit)}`; `RestMemoryClient` (baseUrl, secret). Errors: `ServerDownError`, `AuthError` (401).
- **Tests:** in-process mock HTTP server (Bun.serve) — livez shape, health version, status→count, save round-trip, recall results, 401 → AuthError, connection refused → ServerDownError.
- **Verify:** `bun test apps/cli`.

### M2-3 — Server lifecycle (TDD)
- **Files:** `apps/cli/src/adapters/agentmemory/server.ts`, `server.test.ts`
- **Spec:** `probe(base)` (livez), `ensureRunning({cli, home, base, logFile})` (probe → spawn detached with stdio→logFile → poll livez until ready, timeout 180s first-run), `stop({cli, home})`.
- **Tests:** fake agentmemory CLI (shell script that starts a tiny node HTTP server on a test port / prints "stopped") — probe up, ensureRunning starts+waits, stop brings down. No real agentmemory in unit tests.
- **Verify:** `bun test apps/cli`.

### M2-4 — AgentmemoryAdapter (TDD)
- **Files:** `apps/cli/src/adapters/agentmemory/index.ts`, `index.test.ts`
- **Spec:** implements `BackendAdapter`:
  - `detect()`: node20+ present? CLI installed at `~/.unify/backends/agentmemory/node_modules/.bin/agentmemory`? server livez → version from `health`
  - `install()`: `npm i @agentmemory/agentmemory@0.9.31 --prefix ~/.unify/backends/agentmemory`; verify bin + `node -v >= 20`; write lock entry
  - `status()`: livez down → `healthy:false`, issue "server not running (fix: unify init)"; up → `MemorySummary {total: index.memoriesIndexed}`
  - `sync()`: verify running + report count (memory is pull-based; no periodic diff)
  - `doctor()`: node missing / not installed / version ≠ pinned / server down
- **Tests:** fake runner + MockServer; golden issues arrays.
- **Verify:** `bun test apps/cli`.

### M2-5 — `unify memory` command (round-trip acceptance)
- **Files:** `apps/cli/src/commands/memory.ts`
- **Spec:** `unify memory save <text> [--concepts a,b]`, `unify memory recall <query> [--limit n]` — ensureRunning (auto-start if pinned installed), then client.save/recall; print id / results table.
- **Tests:** stub-server e2e (child process, temp HOME/UNIFY_HOME, stub `agentmemory` script + mock REST) — save prints id, recall prints the saved title.
- **Verify:** `bun test apps/cli`.

### M2-6 — wire status / init / doctor
- **Files:** `commands/status.ts`, `commands/init.ts`, `commands/doctor.ts`, `render.ts`
- **Spec:** status shows `Memory: N entries (agentmemory v0.9.31, http://localhost:3111)` or `Memory: not running (fix: unify init)`; init installs+starts when profile enables agentmemory (respects `--skip-install`); doctor adds agentmemory issues.
- **Tests:** golden render + e2e assertions (stub).
- **Verify:** `bun test apps/cli`, tsc.

### M2-7 — real e2e (sandbox, real 0.9.31)
- **Spec:** isolated HOME + UNIFY_HOME; `unify init` (installs from npm, starts server on 3111) → `unify memory save` → `unify memory recall` (probe text found) → `unify status` (Memory: 1+ entries) → `unify doctor` → server stop, data preserved.
- **Verify:** all exit 0; recall returns the saved memory.

## Exit criteria
Real machine: `unify init` starts pinned agentmemory; `unify status` shows memory count; save/recall round-trip works; doctor clean; server stop/start idempotent.

## Open items (M3+)
- Profile `namespace` → agentmemory mapping (server is a single store; namespace likely via project/agentId scoping — decide in M3)
- Post-sync AGENTS.md → memory injection glue (M3)
- Auto-restart policy on `unify status` (v2)

## Result (2026-10-30) — M2 COMPLETE

All tasks M2-1…M2-7 done. `bun test` = 70 pass / 0 fail (183 expects); `tsc --noEmit` clean on `apps/cli` + `packages/core`.

- **Unit (adapter layer, 24 tests):** client 8, server-lifecycle 5, adapter 11 — all against a fixture-shaped in-process `Bun.serve` mock, no real agentmemory.
- **Command e2e (3 tests):** stub `agentmemory` bash CLI + in-memory REST server; save auto-starts server → id, recall round-trip, no-match.
- **Real e2e (sandbox, real 0.9.31):** isolated `HOME=/tmp/am-home`, `UNIFY_HOME=/tmp/e2e-m2/unify`.
  `unify init --yes` → detects claude, pins skillshare 0.28.0 + agentmemory 0.9.31, **auto-starts the memory server**, inits + first sync.
  `unify memory save "…"` → `saved mem_…`; `unify memory recall "…"` returns the saved probe (score 1.00).
  `unify status` → `agentmemory 0.9.31 0.9.31 ok` + `Memory: 3 entries (agentmemory v0.9.31)`.
  `unify doctor` → `all checks passed`. `agentmemory stop` → data preserved.

### Implementation notes / fixes discovered during build
- **Bun keeps the event loop alive while a spawned child is live, even `detached`** → `ensureRunning` calls `child.unref()` once the server is ready, so the CLI exits instead of hanging (the daemon server keeps running).
- **citty positional args** need `type: "positional"`; the memory subcommand's parent `run({rawArgs})` is invoked by citty *after* a subcommand runs, so it must early-return when a subcommand (`save`/`recall`) was requested.
- **`??` and `||` cannot mix** without parens (`opts.x ?? process.env.Y || Z` → `(process.env.Y || Z)`).
- `agentmemory` is a real **npm** package (not a downloaded binary), installed under `~/.unify/backends/agentmemory/` via `npm i --prefix`; its engine (iii) auto-downloads on first run (sandbox disk is a 992 MB tmpfs, so the real e2e reused a warm `~/.agentmemory` data dir to stay under the cap).
