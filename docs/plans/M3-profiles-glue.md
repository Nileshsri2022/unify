# M3 — Profiles + Post-sync Glue Plan

Goal (DESIGN milestone M3): `unify profile work/personal` verified end-to-end;
post-sync hook `inject-agents-md-into-memory` keeps memory aligned with live
AGENTS.md rules; doctor covers the glue.

## Empirical contract — profile scoping (verified 2026-10-30, real server 0.9.31)

- **Write:** `POST /agentmemory/remember` body `{content, concepts, agentId}` → 201,
  stored memory carries `agentId`. (body field wins over server env)
- **Read:** `POST /agentmemory/smart-search` body `{query, limit, agentId}` →
  **filters by agentId in the BODY.** ⚠️ README claims `?agentId=` query param,
  but the query param is empirically IGNORED by smart-search. Use the body field.
- `GET /agentmemory/memories?agentId=<ns>` — query param DOES work there (list endpoint).
- Unscoped recall = all profiles (shared mode default). Per-request body agentId
  gives strict per-profile isolation without any server-side env change:
  one server, N profiles, pure REST.

**Decision:** profile `X` (config `profiles.X.backends.agentmemory.namespace`)
→ every `remember`/`smart-search` from unify carries `agentId: <namespace>`.
Default namespace = profile name ("work"/"personal"); schema default stays "shared".

## Canonical AGENTS.md

- Location: `~/.unify/AGENTS.md` (user-editable, git-friendly). `unify init`
  creates a small template if missing.
- Glue action id: `inject-agents-md-into-memory` (DESIGN §5 `glue.post-sync`).
- Idempotency: content hash (sha256, first 12 hex) in a marker line
  `AGENTS.md snapshot [unify:hash=<hash12>]` at the top of the saved memory.
  Before saving, smart-search for the marker; if a result title matches the
  current hash → skip ("up to date"). Otherwise save (new version; agentmemory
  keeps the version chain).

## Tasks

### M3-1 — Contract pin (this doc + fixtures README note) ✅ (probes above)

### M3-2 — core: default `personal` profile + `switchProfile`
- **Files:** `packages/core/src/config.ts` (+test)
- **Spec:** `defaultConfig()` gains `profiles.personal` (same detected-target
  shape; agentmemory namespace "personal"); `defaultConfigForTools` sets targets
  on both. `switchProfile(file, name): Promise<UnifyConfig>` — load, validate
  `name ∈ profiles` (error listing available), set `profile`, write back,
  return new config. Never throws on parse (LoadResult semantics).
- **Verify:** `bun test packages/core`.

### M3-3 — client: agentId on save/recall
- **Files:** `apps/cli/src/adapters/agentmemory/client.ts` (+test)
- **Spec:** `save(content, concepts, agentId?)` → body `agentId` when set;
  `recall(query, limit, agentId?)` → body `agentId` when set (NOT query param).
- **Tests:** mock asserts body contains agentId when passed, omits when not.

### M3-4 — adapter + memory command: profile plumbing
- **Files:** `agentmemory/index.ts`, `commands/memory.ts`
- **Spec:** adapter `save(recall)` accept optional `agentId` (passthrough).
  `unify memory save/recall`: read unify.yaml → active profile →
  `agentId = ap.agentmemory.namespace`; agentmemory disabled in profile →
  exit 1 "agentmemory disabled for profile <p> (fix: unify.yaml)".
- **Verify:** stub e2e asserts saved memory carries agentId, recall scoped.

### M3-5 — `unify profile` command
- **Files:** `apps/cli/src/commands/profile.ts`, `index.ts` wiring
- **Spec:** `unify profile` → prints active profile + its backends/namespace.
  `unify profile <name>` → switchProfile; prints what flipped
  (skillshare targets, memory namespace). Unknown name → exit 1 + list.
- **Verify:** e2e (stub env): switch work→personal→work, yaml updated, status
  reflects namespace in Memory line.

### M3-6 — post-sync glue: inject-agents-md-into-memory
- **Files:** `apps/cli/src/glue/agentsMd.ts`, `commands/sync.ts`, `commands/init.ts`
- **Spec:** after successful NON-dry-run skillshare sync: if `glue.post-sync`
  contains the action and profile enables agentmemory → read
  `~/.unify/AGENTS.md`; missing → skip with hint line; present → marker-hash
  idempotent save (truncation cap 8 KB + note). Prints:
  `glue: AGENTS.md snapshot → memory (profile: <p>, hash <hash12>)` or
  `glue: AGENTS.md snapshot up to date (hash <hash12>)`.
  `unify init` writes a template AGENTS.md when missing.
  Failure of glue never fails sync (warn + continue; doctor flags repeats).
- **Verify:** unit (fake client: inject / up-to-date / disabled / missing) +
  e2e (stub: first sync injects, second sync skips).

### M3-7 — status/doctor wiring
- **Spec:** status Memory line → `N entries (agentmemory v0.9.31, profile: work)`.
  doctor: glue enabled + `~/.unify/AGENTS.md` missing → warn
  (`fix: create ~/.unify/AGENTS.md`).
- **Verify:** golden updates + e2e.

### M3-8 — real e2e
- **Spec:** real env: `init` (work active, template AGENTS.md created) →
  save on work → `unify profile personal` → recall on personal empty for work
  probe → save on personal visible → status shows `profile: personal` →
  glue injects on sync → doctor clean.
- **Verify:** all exit 0; isolation proven (cross-profile recall returns nothing).

## Exit criteria
`unify profile work/personal` flips skillshare targets + memory namespace
end-to-end; post-sync glue keeps one fresh AGENTS.md snapshot per profile in
memory; doctor covers glue; full suite green; real e2e proves isolation.

## Result (2026-10-30) — M3 COMPLETE

All tasks M3-1…M3-8 done. `bun test` = 99 pass / 0 fail (283 expects);
`tsc --noEmit` clean (apps/cli + packages/core).

- **Profiles:** `defaultConfig()` now ships `work` + `personal` (namespaces named
  after the profile); `defaultConfigForTools` sets targets on both. New
  `switchProfile(file, name)` in `@unify/core` (validates, rewrites, never
  clobbers unknown). `unify profile` / `unify profile <name>` show + switch.
- **Memory namespacing:** `save`/`recall` carry `agentId` in the REST body
  (verified the server ignores the `?agentId=` query param on smart-search).
  `unify memory save/recall` scope to the active profile's namespace; disabled
  profile → clean exit 1.
- **Post-sync glue** `inject-agents-md-into-memory`: hash-marker idempotent
  snapshot of `~/.unify/AGENTS.md` per profile (8 KB cap). Auto-starts the
  memory server if down; never fails the sync; `init` writes a template
  AGENTS.md; doctor flags a missing one (glue radar).

### Real e2e (real 0.9.31 server, isolated HOME/UNIFY_HOME)
`profile` show/switch; work save tagged; **personal recall cannot see the work
probe (and vice-versa) — isolation proven both directions**; `sync` injects
`AGENTS.md snapshot → memory (hash …)`, second `sync` → `up to date`, edit →
re-inject with new hash; personal scope cannot see work's glue snapshot;
`status` shows `Memory: N entries (agentmemory v0.9.31, profile: work)`;
`doctor: all checks passed`; server stop preserves data.

### Fixes discovered during build
- **`loadUnifyAt` profile validation bug (latent M1):** required `profile === "work"`
  hardcoded — any other active profile errored. Relaxed to `profile ∈ profiles`.
- **`writeLastSync` ENOSPC/ENOENT:** didn't `mkdir` the `state/` dir; now creates it.
- **citty optional positional:** `required: false` needed for `unify profile` no-arg form.
