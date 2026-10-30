# M5 — `unify ui`: JSON API + real dashboard wiring

Goal (DESIGN §11 M5): `unify ui` starts a local dashboard on `127.0.0.1:<port>`
(React app + JSON API, same server). Dashboard consumes REAL data (mock.ts
becomes an offline fallback with a visible "demo data" banner). Polish +
release-ready.

## API surface (same server, prefix `/api`)

| Endpoint | Method | Payload out | Notes |
|---|---|---|---|
| `/api/status` | GET | `{status: UnifiedStatus, lastSync, memoryLine}` | same logic as `unify status --json` |
| `/api/sync` | POST `{dryRun?, target?}` | `{result: SyncResult, glue: string[]}` | runs skillshare sync + post-sync glue; applies when `dryRun` false |
| `/api/doctor` | GET | `{issues: HealthIssue[]}` | same as `unify doctor` (no exit-code semantics) |
| `/api/profiles` | GET | `{active, profiles: [{name, backends}]}` | from unify.yaml |
| `/api/profiles` | POST `{name}` | `{active}` | switchProfile; 404 on unknown (lists available) |
| `/api/memory` | GET `?q=&limit=&profile=` | `{profile, namespace, results: RecallResult[]}` | auto-starts server; `profile` overrides active (dashboard tabs) |
| `/api/memory` | POST `{text, concepts?}` | `{id, profile}` | active-profile namespace |

Errors → `{error: string}` with 400 (bad input) / 500 (backend failure).
Static: everything else GET → `apps/dashboard/dist` files (mime by ext),
unknown non-`/api` paths → `index.html` (SPA). POST/PUT/DELETE non-`/api` → 405.

## Tasks

### M5-1 — API handler (TDD)
- **Files:** `apps/cli/src/ui/server.ts`, `server.test.ts`
- **Spec:** `createApiHandler({userHome, unifyHome, distDir}) → fetch(req)`.
  Reuses registry/adapters/glue/switchProfile — no shell-out.
- **Tests:** in-process `Bun.serve` + stub env (skillshare PATH stub + stub
  agentmemory, same pattern as glue-e2e): status shape, doctor shape,
  profiles get/switch/unknown-404, memory get/post round-trip, sync dry-run,
  404 on unknown /api, 405 on POST /unknown.

### M5-2 — static serving + SPA fallback (TDD)
- **Files:** same `server.ts`
- **Spec:** serve dist files; SPA fallback; 404 JSON for missing assets.
- **Tests:** temp dist dir with index.html + asset file.

### M5-3 — `unify ui` command (TDD)
- **Files:** `apps/cli/src/commands/ui.ts`, `index.ts` wiring
- **Spec:** `unify ui [--port N]` (default 7420, `UNIFY_UI_PORT` overrides).
  Dist missing → build (`bun run build` in dashboard dir) with a progress line.
  Prints URL; binds 127.0.0.1 only; SIGINT/SIGTERM → clean shutdown (server
  stopped, exit 0). `--api-only` skips static serving (for vite dev workflow).
- **Tests:** spawn `unify ui --port <free>` in stub env → GET /api/status +
  GET / (HTML), then kill → port freed.

### M5-4 — dashboard: real API (TDD via build + manual contract)
- **Files:** `apps/dashboard/src/lib/api.ts`, screens/*, `App.tsx`, `data/mock.ts`
- **Spec:** `api.ts` = typed fetch wrappers + `useAsync` hook (loading/error).
  Sidebar footer: green "live" when API reachable, amber "demo data" fallback
  (screens fall back to mock.ts when fetch fails). Profile dropdown → real
  list + POST switch (refetches everything after switch). Topbar search →
  `/api/memory?q=` (debounced). Sync button → POST dry-run → apply. Memory
  screen: work/personal tabs → `?profile=` override. Doctor screen: real
  issues. Overview: real backends/targets/counts.
- **Verify:** `bun run build` clean; `tsc` clean.

### M5-5 — vite dev proxy
- **Files:** `apps/dashboard/vite.config.ts`
- **Spec:** dev server proxies `/api` → `http://127.0.0.1:7420` so `vite dev`
  + `unify ui --api-only` = hot-reload workflow.

### M5-6 — full e2e + polish
- **Spec:** real dashboard build + stub env: `unify ui` serves HTML (real
  built app), all /api endpoints correct, profile switch flips the memory
  namespace live, Ctrl+C clean.
- **Polish:** README quickstart section (`unify ui`), `unify --help` line,
  version bump 0.2.0, CHANGELOG if present.

## Exit criteria
`unify ui` on a machine with both backends: dashboard shows live backends,
targets, memory (search works, work/personal tabs isolated), profile switch
works from the UI, sync dry-run + apply work from the UI, doctor shows real
issues. No mock data when API is up (banner only in offline/demo mode).

## Result (done 2026-10-30)

All tasks M5-1…M5-6 complete. **120 tests pass** (15 API/static + 6 ui-helper
+ 99 prior), tsc clean, version → 0.2.0.

**Real e2e on real 0.9.31 server (24/24, /tmp/e2e-m5.sh):**
1. Static: `GET /` → built dashboard, hashed asset 200, SPA fallback, missing
   asset 404 JSON.
2. `/api/status` → `profile: work`, skillshare installed (0.28.0), `memoryLine` present.
3. `/api/doctor` → issues array.
4. Profiles: GET lists (active=work); POST personal → yaml rewritten on disk
   (`profile: personal`); unknown → 404.
5. Memory (server auto-started by first save): POST → `mem_*` id + `profile:
   work`; recall `profile=work` finds probe; `profile=personal` does NOT
   (isolation); no `q` → 400.
6. Sync: dry-run → `dryRun:true`; apply → `dryRun:false` + glue line
   (`glue: AGENTS.md snapshot → memory (profile: work, hash …)`).
7. Status after apply: `memoryLine` = `N entries (agentmemory v0.9.31,
   profile: work)`; `lastSync.at` set.
8. SIGINT → exit 0, port closed.

**Vite dev workflow verified:** `unify ui --api-only` (7420) + `vite dev`
(5173) → proxy forwards `/api/*` to the real API (real 0.28.0/0.9.31 payload),
SPA served, zero proxy errors. Proxy target honors `$UNIFY_UI_PORT` (default 7420).

**Key architecture decision:** one `Orchestrator` (apps/cli/src/ui/
orchestrate.ts) is the single shared code path for CLI commands and the API
handler, so the dashboard and CLI can never disagree. `createApiHandler`
(ui/server.ts) mounts `/api/*` + static dist (SPA fallback) on one 127.0.0.1
port. Dashboard `src/lib/live.tsx` probes the API on mount: live → real data
only; offline → mock data + visible demo banner.

**Bugs fixed during M5 (captured in tests):**
- dist path was 4-up from `commands/` (not 3); and in a **compiled binary**
  `import.meta.dir` is virtual (`/$bunfs/root`) while `process.execPath` is
  the binary itself → `findDashboardDir` resolves the dashboard from the
  binary's location (3-up) and falls back to `$UNIFY_UI_DIST` with a readable
  error when the repo layout is absent. `findBun` locates the real bun for
  auto-build (execPath is not bun when compiled).
- `Bun.spawn` ENOENT was a missing `cwd` misreported as the executable path.
All pinned by `ui.test.ts` (resolveDistDir/resolvePort/findDashboardDir/findBun).
