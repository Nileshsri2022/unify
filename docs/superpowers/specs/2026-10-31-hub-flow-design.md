# Hub flow (Sync Everything) — design

User-approved flow (see `~/workspace/your_files/ui-flow.md`, Hinglish
version given to the user): Overview for looking, Hub for doing, one
main action, cached inventory so the screen is never empty, summary
first, per-provider details on demand.

## What changes vs PR #13 Hub UI
- Hub screen is empty until a button is clicked, because collect
  scans and copies files. Fix: the server saves the last hub result
  to disk after every collect/sync, and `GET /api/hub` returns it.
  Opening Hub (and Overview) then shows the last known inventory
  instantly, with its timestamp. The button only refreshes it.
- Two buttons that looked identical (Collect, Hub Sync) become one
  primary action, **Sync Everything**, plus a small secondary
  "Collect (preview only)" button. Sync Everything = hubSync
  (collect + distribute) followed by skillshare sync apply
  (the old Sync screen's job, including glue). If skillshare fails,
  the hub result is still returned with a skillshare error field —
  a partial failure must not blank the hub result.
- Result rendering: summary banner first (providers, total skills,
  total MCP servers, copied, skipped, merged, skillshare changes),
  then per-provider rows with a skill **count** and an expandable
  full list (native `<details>`), instead of a truncated one-line
  list where every provider looked identical.
- Overview gains a small Hub summary card (last hub sync, total
  skills/providers) from the same cached result. It does not replace
  the skillshare stat tiles; it adds the hub line that was missing.
- Sync screen is kept, but its title/subtitle say "skillshare only",
  so it is no longer mistaken for the main sync. Removing it
  entirely is out of scope — its dry-run preview is still useful.

## Non-goals
- No per-skill/per-server actions, no watcher UI, no memory
  mirroring, no change to collision rules (skip, never overwrite)
  or secret stripping.
- No change to CLI commands: `hub collect`, `hub sync`, `sync`
  stay exactly as they are. This PR is UI flow only, plus the
  cache file that makes it render instantly.

## Implementation
- `global-hub/service.ts`: after hubCollect/hubSync, write
  `global/last-hub.json` = `{ at, collect, distribute? }`.
  `readHubStatus(hub)` reads it back (null if missing/unparsable).
  The file lives at the hub root, not in a provider subdir, so
  distribute's readdir (directories only) ignores it.
- Orchestrator: `hubStatus()`, `syncEverything()` (hubSync, then
  best-effort `this.sync({ dryRun: false })`, catching its error
  into a `skillshareError` field instead of throwing).
- Server: `GET /api/hub`, `POST /api/hub/sync-everything`.
  Existing `POST /api/hub/collect` and `POST /api/hub/sync` stay.
- Dashboard: `api.hubStatus()`, `api.syncEverything()`; Hub screen
  loads cached status on mount, primary Sync Everything button,
  secondary Collect (preview only), summary banner, count +
  `<details>` lists; Overview fetches hub status once and shows
  the Hub summary card when a cached result exists.
- Tests: service cache write/read, server GET /api/hub (null then
  cached) and POST /api/hub/sync-everything (hub + skillshare
  present), using the existing stub fixtures. Dashboard verified
  by typecheck + vite build.
