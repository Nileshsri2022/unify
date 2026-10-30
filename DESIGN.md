# unify — Design Document (v1)

> One manager for your local AI coding-agent stack: config distribution, persistent memory, unified status.
> Status: DRAFT — awaiting sign-off. Process: obra/superpowers (brainstorming → design → plans → TDD).

## 1. Problem

A developer runs multiple AI coding tools locally (Claude Code, Cursor, Codex, Gemini CLI, ...). Today:
- Skills, MCP servers, rules, hooks, plugins must be configured per tool, in per-tool formats → drift.
- Knowledge taught in chat (corrections, decisions, conventions) is lost when switching tools → "explain again".
- No single view of: which tool is in sync, what the memory contains, what it costs.

## 2. Positioning

unify is a **thin control plane**, NOT a reimplementation. It composes existing best-of-slice tools:

| Slice | Backend (v1) | How it's driven |
|---|---|---|
| Config distribution (skills, rules, MCP, hooks, plugins; 76+ targets) | **skillshare** (MIT) | its CLI (exec) |
| Persistent memory (capture, recall, team namespaces) | **agentmemory** (Apache-2.0) | MCP stdio client |

v2 candidates: mcpm.sh (MCP registry), ccusage (cost tracking) — same adapter pattern.

**Non-goals (v1):** no new MCP servers, no orchestration/running agents, no Windows-first (macOS + Linux first), no hosted SaaS.

## 3. Product scope v1

### Commands

| Command | Behavior |
|---|---|
| `unify init` | Interactive: detect installed AI tools + backends, install backends (pinned, SHA256), generate `unify.yaml`, first `sync` |
| `unify sync` | Run adapters in dependency order. `--dry-run` default-preview, `--target <t>` to scope |
| `unify status` | One-screen table: backend health, per-target sync state, memory size, active profile (also `--json`) |
| `unify doctor` | Pinned-vs-installed versions, config drift, IDE coverage gaps, env/key checks, stale locks |
| `unify profile <name>` | Switch profile (e.g. work/personal): flips backend config sections, memory namespace, cost attribution tag |
| `unify ui` | Local dashboard on `127.0.0.1:<port>` (React app + JSON API) |
| `unify backends add\|remove\|update\|pin` | Backend lifecycle; updates always go through `pin` with hash verification |

### Glue workflows (the differentiators — no single backend does these)

1. **Profiles** — one switch flips config + memory namespace + attribution together.
2. **Post-sync hook** — after config sync, inject the canonical `AGENTS.md` snapshot into agentmemory so memory recall always matches live rules.
3. **Unified doctor** — cross-backend health in one pass (version pins, drift, coverage, env).
4. **Unified status** — one object model feeding both CLI table and dashboard.

## 4. Architecture

```
                        ┌──────────────────────────────────────────┐
                        │              unify CLI (Bun)             │
                        │  commands · config · state · orchestrator│
                        └──────┬──────────────┬──────────────┬─────┘
                               │ exec         │ MCP stdio    │ Bun.serve
                    ┌──────────▼─────┐  ┌─────▼─────────┐  ┌──▼─────────────────┐
                    │ skillshare CLI │  │ agentmemory   │  │ Dashboard          │
                    │ (binary, pin)  │  │ (MCP server)  │  │ React+Vite+shadcn  │
                    └────────────────┘  └───────────────┘  │ + JSON API         │
                                                            │ /api/status ...    │
                        ┌──────────────────────────────────┐
                        │ State: ~/.unify/                 │
                        │   unify.yaml  backends.lock.json │
                        │   state/last-sync.json  cache/   │
                        └──────────────────────────────────┘
```

### Adapter interface (spec)

```ts
interface BackendAdapter {
  id: string                       // "skillshare" | "agentmemory"
  detect(): Promise<Detection>     // installed? path, version, config paths
  install(manifest: BackendManifest): Promise<InstallResult>  // pinned, hash-verified
  status(): Promise<BackendStatus> // parsed from backend's own CLI/MCP output
  sync(opts: SyncOptions): Promise<SyncResult>   // dry-run supported
  doctor(): Promise<HealthReport>  // issues[] with severity + suggested fix
}
```

- **skillshare adapter**: spawns `skillshare target list`, `skillshare sync`, `skillshare doctor`-equivalent commands; parses stdout into `BackendStatus`. Never edits skillshare state files directly.
- **agentmemory adapter**: spawns the MCP server over stdio; calls its tools (memory list/save/recall). Lifecycle = `bun add -g` + version pin.
- Adapters are the ONLY place that knows a backend's CLI flags / MCP tool names → upstream churn is contained here (contract tests per pinned version).

### Data model (shared `packages/core`)

- `UnifiedStatus`: `{ profile, backends: BackendStatus[], targets: TargetState[], memory: MemorySummary, generatedAt }`
- `TargetState`: per IDE/CLI → `in-sync | drift | missing | not-installed`
- `HealthIssue`: `{ severity: info|warn|error, backend, message, fix? }`
- All types defined once in core, shared by CLI, API, and dashboard (zod schemas at the boundary).

## 5. Configuration

`~/.unify/unify.yaml` (single source of truth for unify):

```yaml
version: 1
profile: work
profiles:
  work:
    backends:
      skillshare: { enabled: true, targets: [claude, cursor, codex, gemini] }
      agentmemory: { enabled: true, namespace: work }
  personal:
    backends:
      skillshare: { enabled: true, targets: [claude, gemini] }
      agentmemory: { enabled: true, namespace: personal }
glue:
  post-sync: [inject-agents-md-into-memory]
secrets:                      # env references only — no values in this file
  STITCH_API_KEY: { env: STITCH_API_KEY }
```

`~/.unify/backends.lock.json` (machine-local, gitignored if `~/.unify` is under version control):

```json
{ "skillshare": { "version": "0.28.0", "sha256": "…", "source": "github-release" } }
```

Secrets rule: `unify.yaml` may only reference env vars. Keys live in env / OS keychain, never in repo.

## 6. Tech stack (confirmed)

| Layer | Choice | Notes |
|---|---|---|
| Runtime | **Bun** | single codebase; `bun build --compile` → single `unify` binary |
| Language | **TypeScript** (strict) | shared types across CLI + dashboard |
| CLI | **citty** or **clipanion** (lightweight TS CLI) | decide in plan; citty recommended (Bun-native) |
| Config | YAML + **zod** validation | schemas in core |
| MCP client | `@modelcontextprotocol/sdk` (TS) | for agentmemory stdio |
| Dashboard | **React 19 + Vite + Tailwind + shadcn/ui** | served by `Bun.serve` (static + JSON API) in the CLI binary |
| UI design | **Google Stitch** (API key via env) | design-first: generate screens → human approves → convert to shadcn components |
| Repo | Bun workspaces monorepo | see layout |
| CI | GitHub Actions | typecheck, unit tests, `--compile` for 3 OS/arch, smoke `doctor` |
| Testing | **Bun test** | unit (core, adapters with mocked exec/MCP), contract tests per pinned backend version, golden files for status output |

### Repo layout

```
unify/
  package.json            # bun workspaces
  packages/
    core/                 # shared types + zod schemas + config/state loaders
  apps/
    cli/                  # src: commands/, adapters/{skillshare,agentmemory}/, server/
    dashboard/            # vite react app (shadcn)
  docs/                   # DESIGN.md, PROGRESS.md, plans/
  design/                 # Stitch screens (png/html) + design notes
  .github/workflows/ci.yml
```

## 7. Dashboard (screens → Stitch prompts)

All screens: dark developer-tool theme, shadcn idioms (cards, tables, badges, command-palette), one-column info density like `htop`.

1. **Overview** — profile switcher, backend health cards, IDE sync matrix (grid: tool × in-sync/drift), memory summary, last-sync time.
2. **Sync** — per-target rows with state badges, dry-run diff preview, apply button, per-target rerun.
3. **Memory** — search box, recent captures list (namespace tab: work/personal), superseded items dimmed, "what changed since last sync".
4. **Profile** — work/personal cards: which backends/targets/namespace each flips; active profile highlighted.
5. **Doctor** — issue list grouped by severity, each with suggested fix + one-click "apply fix" (dry-run first).

Flow: Stitch generates each screen (prompt derived from this doc) → `design/` → user approves → convert to shadcn React components (Phase M4).

## 8. Session handoff (v2, schema reserved now)

`unify handoff export --task <id>` → `~/.unify/handoffs/<ts>.yaml`:

```yaml
version: 1
task: "payments retry queue"
tools: { from: cursor, to: claude }
context:
  objective: …
  done: [ … ]
  open: [ … ]
  files: [ … ]
  decisions: [ { what: …, why: …, rejected: … } ]   # pulled from agentmemory recall
  mcp-active: [ … ]
notes: free-text
```

Import = inject into target tool's native session-context mechanism (AGENTS.md snippet / memory save). Design now, build in v2.

## 9. Security

- `STITCH_API_KEY` and any user secrets: **env only**. `.env` gitignored; never bundled in compiled binary.
- Backend binaries installed from official releases, SHA256-verified against lock file.
- Doctor flags: missing env refs, world-readable state dirs, stale lock hashes.
- `~/.unify/` default perms 0700.

## 10. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Upstream churn (skillshare flags, agentmemory tool names) | adapters isolated + pinned versions + contract tests; `doctor` detects mismatches |
| `bun build --compile` edge cases (platforms, size) | fallback distribution: `bunx unify` / install script; test matrix in CI |
| Config duplication (unify.yaml vs skillshare's own config) | unify.yaml is the authority for targets/profiles; skillshare adapter renders its native config from it; documented precedence |
| Scope creep (all 4 backends, handoff) | v1 = 2 backends + glue; v2 gated on v1 release |
| Key leakage in chat/commits | env-only policy + rotate STITCH key after setup; .gitignore + pre-commit guard test |

## 11. Milestones

| # | Milestone | Exit criteria |
|---|---|---|
| M0 | Scaffold: workspaces, CI, core types, `unify.yaml` loader | `bun test` green, `unify version` runs |
| M1 | skillshare adapter (detect/install/status/sync/doctor) + `init` + `sync` + `status` | real machine: `unify sync` updates 4 targets; dry-run verified |
| M2 | agentmemory adapter (MCP client) | `unify status` shows memory summary; save/recall round-trip test |
| M3 | Profiles + post-sync glue hook + `doctor` | `unify profile work/personal` verified end-to-end |
| M4 | Stitch screens → shadcn dashboard (5 screens) | each screen approved in `design/`, rendered in dashboard |
| M5 | `unify ui` integration + polish + first release | npm + GitHub releases; README quickstart works on clean machine |
| M6 (v2) | handoff; mcpm + ccusage adapters | separate design doc |

## 12. Process (superpowers)

1. **Brainstorming** — done (this doc + 4 locked decisions).
2. **Design sign-off** — user approves this doc (or edits).
3. **writing-plans** — per-milestone task lists: 2–5 min tasks, exact file paths, verification steps.
4. **Worktree + TDD** — isolated branch; RED-GREEN-REFACTOR per task; review between tasks.
5. **Finish branch** — verify tests, merge.
