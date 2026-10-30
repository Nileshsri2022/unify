# agentmemory v0.9.31 — pinned REST contract

These fixtures are the **contract** between unify and agentmemory. All client
tests run against an in-process mock server shaped like these files —
**no network, no real server in CI**.

## Pin

- npm package: `@agentmemory/agentmemory@0.9.31` (Node 20+; bin `agentmemory`)
- Lifecycle: `agentmemory` (start, foreground supervisor) / `agentmemory stop`
  (data preserved) / `agentmemory init` (writes `~/.agentmemory/.env`, keyless)
- REST: `http://localhost:3111` (viewer `:3113`), Bearer = `~/.agentmemory/secret`
- Pinned iii-engine (auto-installed on first start): 0.25.0
- Data dir: `~/.local/share/agentmemory/state_store.db/`

## How fixtures were recorded

Recorded 2026-10-30 on linux/amd64, isolated `$HOME`, keyless mode, 1 pre-seeded
memory. Exact commands:

| File | Request |
|---|---|
| `livez.json` | `GET /agentmemory/livez` (unauthenticated) |
| `health.json` | `GET /agentmemory/health` (Bearer) |
| `status.json` | `GET /agentmemory/status` (Bearer) — `index.memoriesIndexed` is the memory count |
| `remember.json` | `POST /agentmemory/remember` `{content, concepts[]}` (Bearer) |
| `smart-search.json` | `POST /agentmemory/smart-search` `{query, limit}` (Bearer) |

## Notes

- `livez` is the liveness probe (no auth); `health`/`status` require Bearer —
  a 401 means the secret is missing/stale, not that the server is down.
- Transport decision: unify talks **REST**, not the MCP shim (`agentmemory mcp`).
  The shim is a thin proxy that needs the same running server for its full
  tool surface, so managing the server is mandatory either way — see
  `docs/plans/M2-agentmemory-adapter.md`.
- If agentmemory changes response shapes, `client.test.ts` / `index.test.ts`
  fail loud on purpose (upstream-churn radar). Re-record, bump the pin,
  re-baseline.
