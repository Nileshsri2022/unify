# M0 — Scaffold Plan

Goal: repo skeleton, CI, shared core types, `unify version` binary, tests green.
Conventions: Bun workspaces · TypeScript strict · no new deps beyond listed.
TDD: every task = RED (failing test or failing verify) → GREEN → commit.

## Tasks

### M0-1 — git init + workspace root
- **Files:** `.gitignore`, `package.json`, `tsconfig.base.json`
- **Spec:**
  - `package.json`: name `unify`, private, `workspaces: ["apps/*", "packages/*"]`, scripts: `typecheck` (tsc -b), `test` (bun test), `build:cli` (bun run --filter @unify/cli build)
  - `tsconfig.base.json`: strict, target ES2022, moduleResolution bundler
  - `.gitignore`: `node_modules/`, `dist/`, `.env`, `.DS_Store`, `*.log`, `design/*.tmp`
- **Verify:** `git init` done · `bun install` exit 0 · `bun run typecheck` exit 0

### M0-2 — packages/core: types
- **Files:** `packages/core/package.json`, `packages/core/src/index.ts`, `packages/core/src/types.ts`
- **Spec (export these interfaces exactly):**
  - `HealthIssue { severity: "info"|"warn"|"error"; backend: string; message: string; fix?: string }`
  - `Detection { installed: boolean; path?: string; version?: string }`
  - `BackendStatus { id: string; installed: boolean; version?: string; pinnedVersion?: string; healthy: boolean; issues: HealthIssue[] }`
  - `TargetState { target: string; tool: string; state: "in-sync"|"drift"|"missing"|"not-installed"; lastSync?: string; detail?: string }`
  - `MemorySummary { namespaces: { name: string; count: number }[]; total: number; lastCapture?: string }`
  - `UnifiedStatus { profile: string; backends: BackendStatus[]; targets: TargetState[]; memory: MemorySummary; generatedAt: string }`
  - `SyncOptions { dryRun: boolean; targets?: string[] }`
  - `SyncResult { backend: string; dryRun: boolean; changes: { target: string; action: string }[]; error?: string }`
  - `BackendManifest { version: string; sha256: string; source: string }`
  - `BackendAdapter { id: string; detect(): Promise<Detection>; install(m: BackendManifest): Promise<void>; status(): Promise<BackendStatus>; sync(o: SyncOptions): Promise<SyncResult>; doctor(): Promise<HealthIssue[]> }`
- **Verify:** `bun run typecheck`

### M0-3 — packages/core: config loader (zod)
- **Files:** `packages/core/src/config.ts`, `packages/core/src/config.test.ts`, `packages/core/testdata/unify-ok.yaml`, `packages/core/testdata/unify-badprofile.yaml`
- **Spec:** zod schema for `unify.yaml` per DESIGN §5 (version, profile, profiles: map of `{backends: {skillshare: {enabled, targets?}, agentmemory: {enabled, namespace?}}}`, glue: `{post-sync: string[]}`, secrets: map of `{env: string}`). `loadUnify(homeDir): { config?, errors: string[] }` — missing file → defaults, no throw.
- **Tests:** valid parses · missing file → defaults · bad profile ref → errors[] non-empty
- **Verify:** `bun test packages/core`

### M0-4 — packages/core: state paths
- **Files:** `packages/core/src/state.ts`, `packages/core/src/state.test.ts`
- **Spec:** `UNIFY_HOME` = `$UNIFY_HOME` or `~/.unify`; `ensureHome()` mkdir 0700; exports: `paths.config`, `paths.lock`, `paths.lastSync`, `paths.backendsBin`, `paths.cache`
- **Tests:** with `UNIFY_HOME=<tmp>` — dirs created with correct mode; paths resolve under tmp
- **Verify:** `bun test packages/core`

### M0-5 — apps/cli skeleton
- **Files:** `apps/cli/package.json`, `apps/cli/src/index.ts`, `apps/cli/src/commands/version.ts`
- **Spec:** citty CLI; `unify version` prints name+version from package.json; build script: `bun build src/index.ts --compile --outdir dist`
- **Verify:** `bun run build:cli` && `./apps/cli/dist/unify version`

### M0-6 — apps/dashboard skeleton
- **Files:** `apps/dashboard/` (Vite react-ts: `index.html`, `src/main.tsx`, `src/App.tsx`, `vite.config.ts`)
- **Spec:** minimal App renders `<div>unify dashboard</div>`; (Tailwind + shadcn come in M4, not now — YAGNI)
- **Verify:** `bun run --filter @unify/dashboard build` (vite build passes)

### M0-7 — CI
- **Files:** `.github/workflows/ci.yml`
- **Spec:** on push/PR: setup Bun → `bun install` → `typecheck` → `test` → `build:cli`
- **Verify:** YAML valid (actionlint if available, else manual review)

### M0-8 — README stub
- **Files:** `README.md`
- **Spec:** what unify is (2 lines), stack, quickstart (bun install / build / version), pointer to `docs/DESIGN.md`
- **Verify:** docs only

## Exit criteria
`bun run typecheck` && `bun test` green on clean clone; `./apps/cli/dist/unify version` prints version; CI file present.
