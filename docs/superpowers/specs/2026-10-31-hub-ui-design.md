# Hub UI + neat/simple cleanup — design

## Problem
`unify hub collect` / `hub sync` work in the CLI (verified on the user's
Windows machine, all 19 targets found after the tilde fix), but the
dashboard shows none of it: no Hub screen, no `/api/hub` route. The
dashboard Sync button only runs skillshare sync, so for a user who is
already in-sync it looks like "nothing happens", even though the hub
holds a real per-provider skills/MCP inventory.

Separately, the dashboard carries things the user does not use: cards
that duplicate another screen, a card that is always wrong, and
explainer cards that teach instead of doing. The user asked to keep
only what is relevant, neat and simple.

## Goals
- One new Hub screen, reachable from the sidebar, showing exactly what
  `hub collect` shows: per-provider skills (state + names) and MCP
  servers (state + names), plus the hub path.
- Two buttons on that screen, matching the CLI: Collect (hub-only
  writes, never touches a provider) and Hub Sync (collect, then
  distribute, collisions skipped, secrets stripped — same semantics as
  CLI `hub sync`, no new semantics).
- API: `POST /api/hub/collect` and `POST /api/hub/sync`, through the
  existing Orchestrator, so CLI and UI always agree. No watcher UI:
  `hub watch` stays CLI-only (detection-only, long-running, does not
  fit a request/response screen).
- Cleanup, keep-only-relevant:
  - Keep: Overview stat tiles + backend cards; Sync table + dry-run/
    apply + diff; Memory search + save; Profiles cards + switch;
    Doctor issues.
  - Remove: Overview "IDE sync matrix" (exact duplicate of the Sync
    screen table); Overview "Memory namespaces" card (always says
    "No memories yet" because the adapter hardcodes `namespaces: []`,
    and it duplicates the Memory screen + the Memories tile — the
    Memory screen is the source of truth for memory, not this card);
    Sync "Safety" explainer card; Profiles "What a profile switch
    changes" explainer card.
  - No new explainer cards are added anywhere in this PR. The Hub
    screen has a one-line description under its title, like other
    screens, and nothing else.

## Non-goals
- No fix for the namespaces bug itself (that would be a separate
  adapter change: actually counting per-namespace memories). Removing
  the lying card is the cleanup; fixing the count is not in scope.
- No removal of Memory, Profiles, or Doctor screens, and no removal
  of the demo-mode fallback data elsewhere — those screens are
  relevant, and demo fallback is a separate, intentional behaviour.
  Only the cards listed above go.
- No per-skill or per-server actions in the Hub UI (no import,
  delete, or edit from the screen). Collect and Hub Sync are the only
  actions, same as the CLI's safe surface.
- No watcher, no memory mirroring in the Hub UI (memory stays
  snapshot-only, as in the hub design).

## Implementation approach
- Extract the CLI hub logic into `apps/cli/src/global-hub/service.ts`:
  `skillTargets`, `mcpTargets`, `hubCollect`, `hubSync`. The CLI
  command (`commands/hub.ts`) becomes a thin printer over the service,
  with identical output. This is the only way to avoid duplicating
  target resolution, dedupe, and secret-stripping in the server.
- Orchestrator gains `hubCollect()` / `hubSync()` delegating to the
  service with `this.userHome` / `this.unifyHome`.
- Server (`ui/server.ts`) gains `POST /api/hub/collect` and
  `POST /api/hub/sync`, returning the service result as JSON.
- Dashboard (`lib/api.ts`, `lib/live.tsx`, `App.tsx`, new
  `screens/Hub.tsx`): `hub` screen id, sidebar entry, API client
  methods, and a screen with two buttons, a hub-path line, a skills
  table, an MCP table, and, after a Hub Sync, the distribute rows.
  Skill/MCP name lists are shown joined and truncated by CSS, not
  expanded into one row per item — the screen stays a summary, like
  Overview, not a file browser.
- Tests: service-level test is covered by existing hub tests
  (collect/distribute); add API contract tests in `ui/server.test.ts`
  for both new routes, using the existing skillshare stub
  (`target list` fixture) — assert 200, a hub path, and skills/MCP
  rows. Dashboard is verified by typecheck + vite build (no
  component test harness exists in this repo).
- Windows safety: no new path handling — the service reuses
  `expandTilde` (now backslash-aware, PR #12) and `path.join`
  throughout, same as the CLI.
