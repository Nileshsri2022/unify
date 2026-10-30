# unify — Progress

Process: obra/superpowers (methodology followed in-conversation; NOT installed in workspace).

## Stages

- [x] Research: category landscape (skillshare 2.9k⭐, agentmemory 30k⭐, mcpm.sh, ai-setup, bridle, ...)
- [x] Problem refinement: switching pain = static context (AGENTS.md solved) + dynamic memory + config fragmentation + no unified status
- [x] Approach decision: Option A via composition (control plane over existing backends), NOT from-scratch, NOT code-merge
- [x] Brainstorming questions (4 locked decisions):
  1. Stitch = design-first (screens → shadcn convert)
  2. UI = local web dashboard (`unify ui`)
  3. v1 scope = 2 backends (skillshare + agentmemory)
  4. Stack = Bun + TS, monorepo, React + Vite + Tailwind + shadcn/ui
- [x] Design doc written: `DESIGN.md`
- [x] **Design sign-off** (user: "ok")
- [x] writing-plans: `docs/plans/M0-scaffold.md` (8 tasks) + `docs/plans/M1-skillshare-adapter.md` (10 tasks)
- [x] **Basic design (shadcn, mock data)** — apps/dashboard: Vite+React+TS+Tailwind v4+shadcn (radix-nova preset, dark), 5 screens: Overview / Sync / Memory / Profiles / Doctor. tsc clean, prod build OK, dev server live (port 5173, allowedHosts for preview).
- [ ] **Stitch screens** — BLOCKED: API key truncated in chat (secret redaction, `…` at index 8). Fix: user sends base64 of key. Deferred by user ("baad me stitch vala kar denge").
- [x] **M0 scaffold (TDD)** — done 2026-10-30: bun workspaces, packages/core (types + zod config loader + state paths, 7 tests), apps/cli (citty, `unify version`, compiled binary `apps/cli/dist/unify`), CI (2 jobs: cli-core + dashboard), README. Verified: 9 tests pass, tsc clean, prod builds OK. Commits: db63407 → HEAD.
- [x] **M1 skillshare adapter (TDD)** — done 2026-10-30: pinned v0.28.0 (6-platform SHA256 manifest), real captured fixtures, parsers, `SkillshareAdapter` (detect/status/sync/doctor/install, injected Runner), registry, `unify init/sync/status/doctor` commands, golden table tests, stub-binary e2e, contract-pin doc. Drift = source skill not linked in target's skills dir (fs check; dry-run JSON is desired-state not diff). **Real-machine e2e verified**: `init --yes` → detect+yaml+init+sync; drift flagged by `status`/`doctor`; `sync` restores; `doctor` clean. 38 tests pass, tsc clean, compiled binary OK.
- [x] **M2 agentmemory adapter (TDD)** — done 2026-10-30: pinned **@agentmemory/agentmemory 0.9.31** (npm), captured REST fixtures, `RestMemoryClient` (livez/health/status/remember/smart-search; Bearer `~/.agentmemory/secret`), server lifecycle (`probe`/`ensureRunning` detached spawn + `unref()`/`stop`), `AgentmemoryAdapter` (detect/status/fullStatus/sync/doctor/save/recall), `unify memory save|recall`, wired into `status`/`init`/`doctor`. **Transport = REST (not MCP stdio)** — documented deviation from DESIGN §4 (MCP shim is a thin proxy that still needs the same server; REST is the stable surface; MCP stays a v2 option behind the `MemoryClient` seam). **Real e2e verified** (real 0.9.31): `init --yes` auto-starts server; `memory save`→id, `recall` round-trip; `status` shows `agentmemory 0.9.31 ok` + `Memory: 3 entries`; `doctor` clean; stop preserves data. **70 tests pass** (24 adapter + 3 memory-e2e + rest), tsc clean.
- [x] **M3 profiles + post-sync glue (TDD)** — done 2026-10-30: `defaultConfig` ships `work`+`personal`; `switchProfile` in core; `unify profile [name]` show/switch; memory `save`/`recall` scoped by profile namespace via **`agentId` in the REST body** (server ignores the query param); post-sync glue `inject-agents-md-into-memory` = hash-marker idempotent `~/.unify/AGENTS.md` snapshot per profile (8 KB cap, auto-starts server, never fails sync); `init` writes template AGENTS.md; doctor glue radar. **Real e2e verified** (real 0.9.31): profile switch flips namespace; **cross-profile isolation proven both directions**; glue inject → up-to-date → re-inject on edit; status `Memory: N entries (… profile: work)`; doctor clean. **99 tests pass**, tsc clean.
- [ ] M5 ← NEXT (per DESIGN §11): `unify ui` integration — JSON API + wire the (already-built) dashboard to real status/sync/memory/profile/doctor; polish + first release.
- [ ] M4 (Stitch screens) — still BLOCKED on Stitch API key (redacted in chat). Basic hand-crafted shadcn dashboard already exists; Stitch pass deferred by user.

## Decisions log

| Date | Decision | Rationale |
|---|---|---|
| 2026-10-30 | Basic design first (hand-crafted shadcn), Stitch later | User choice; Stitch key blocked by chat redaction |
| 2026-10-30 | shadcn preset: radix-nova (neutral, dark mode, Geist font) | Dev-tool aesthetic per DESIGN §7 |
| 2026-10-30 | npm used for dashboard dev (bun not in sandbox yet) | bun for CLI side in M0 |

## Decisions log

| Date | Decision | Rationale |
|---|---|---|
| 2026-10-30 | Compose skillshare + agentmemory, thin orchestrator | Best-in-slice repos exist; wrapper pattern proven (mise, omnigent) |
| 2026-10-30 | Bun+TS over Go | User preference (JS comfort), MCP SDK native, single codebase CLI+dashboard |
| 2026-10-30 | Stitch API key via env only | Security; key shared in chat → rotate later |
| 2026-10-30 | macOS+Linux first | Windows symlink/junction edge cases deferred |
| 2026-10-30 | Drift detected via filesystem link-existence, not dry-run JSON | Empirical: `sync --dry-run --json` reports desired state, not a diff (linked persists post-apply) |
| 2026-10-30 | Adapters take an injected `Runner` (DI) | Fixture-backed unit tests + stub-binary e2e without network |
| 2026-10-30 | `skillshare target add <name> <path>` for configured-but-undetected targets | `target add` requires an explicit path; default paths taken from skillshare v0.28.0 `internal/config/targets.yaml` |
| 2026-10-30 | agentmemory driven over **REST**, not MCP stdio | `@agentmemory/mcp` shim = thin proxy (full 54 tools only with server); REST surface is stable/documented/curl-testable; MCP remains v2 option behind `MemoryClient` seam (see M2 plan) |
| 2026-10-30 | Profile = memory namespace via **`agentId` in the REST body** | Empirical: `remember`/`smart-search` accept `agentId` in body (per-request, wins over env); the `?agentId=` query param is ignored on smart-search. One server, N isolated profiles, zero server-side config |
| 2026-10-30 | Glue idempotency via **hash marker** in the snapshot's first line | `AGENTS.md snapshot [unify:hash=<sha256-12>]` — a namespaced recall for the marker decides inject-vs-skip; edits create new versions; no duplicate pile-up on repeated syncs |
