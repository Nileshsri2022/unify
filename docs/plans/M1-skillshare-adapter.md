# M1 — skillshare Adapter Plan

Goal: `unify init`, `unify sync`, `unify status` work against real skillshare.
Rules: talk ONLY to skillshare's CLI (never edit its state files) · pinned version · fixtures for every parsed output.

Pinned backend: skillshare **0.28.0** (current at plan time; `backends.lock.json` is the source of truth).

## Tasks

### M1-1 — Adapter base + registry
- **Files:** `apps/cli/src/adapters/base.ts`
- **Spec:** re-export `BackendAdapter` from core; `AdapterRegistry { register(a), get(id), all() }`; helpers to build `UnifiedStatus` from adapter outputs
- **Verify:** typecheck

### M1-2 — exec helper
- **Files:** `apps/cli/src/adapters/exec.ts`, `apps/cli/src/adapters/exec.test.ts`
- **Spec:** `run(cmd, args, {timeoutMs=60000, env?, cwd?}): Promise<{code, stdout, stderr, timedOut}>` — spawn (no shell), ANSI-strip, on timeout kill + flag
- **Tests:** echo passes through · nonzero exit captured · timeout flags `timedOut`
- **Verify:** `bun test apps/cli`

### M1-3 — skillshare detect
- **Files:** `apps/cli/src/adapters/skillshare/detect.ts`, `.../detect.test.ts`, `testdata/skillshare/0.28.0/version.out`, `target-list.out`
- **Spec:** binary candidates: `$UNIFY_HOME/backends/skillshare/bin/skillshare` (pinned local) → `PATH`. Run `--version`, `target list` (JSON if supported, else parse table). Return `Detection` + target list
- **Tests:** run against fixtures (fixture = recorded real stdout of pinned version)
- **Verify:** `bun test apps/cli`

### M1-4 — skillshare install (pinned binary)
- **Files:** `apps/cli/src/adapters/skillshare/install.ts`, `.../install.test.ts`
- **Spec:** read `BackendManifest` from lock; download GitHub release asset for current OS/arch; verify SHA256 (mismatch → throw with HealthIssue-shaped error); extract to `backends/skillshare/bin`, chmod +x
- **Tests:** local fixture asset + hash: ok path, wrong-hash path, corrupt-archive path
- **Verify:** `bun test apps/cli` + manual e2e once on real machine

### M1-5 — skillshare status
- **Files:** `apps/cli/src/adapters/skillshare/status.ts`, `.../status.test.ts`
- **Spec:** `target list` (+ `list` for sync state) → `TargetState[]` (`in-sync|drift|missing|not-installed`); compose `BackendStatus`
- **Tests:** golden fixture → expected TargetState array
- **Verify:** `bun test apps/cli`

### M1-6 — skillshare sync
- **Files:** `apps/cli/src/adapters/skillshare/sync.ts`, `.../sync.test.ts`
- **Spec:** dry-run: `skillshare sync --dry-run` → parse changes; apply: `skillshare sync`; honor `SyncOptions.targets` (pass-through to skillshare target filtering if supported, else filter results)
- **Tests:** fixtures for dry-run + apply stdout
- **Verify:** `bun test apps/cli`

### M1-7 — skillshare doctor
- **Files:** `apps/cli/src/adapters/skillshare/doctor.ts`, `.../doctor.test.ts`
- **Spec:** issues: not installed · installed ≠ pinned · lock hash stale · configured target not installed on machine
- **Tests:** each issue triggered by mocked detect/lock
- **Verify:** `bun test apps/cli`

### M1-8 — `unify init` command
- **Files:** `apps/cli/src/commands/init.ts`
- **Spec:** flow: `ensureHome()` → detect host AI tools (check `~/.claude`, `~/.cursor`, `~/.codex`, `~/.gemini`, `~/.config/zed`, ...) → print detected → install backends per active profile → write `unify.yaml` if absent (targets = detected tools ∩ skillshare targets) → `sync --dry-run` → confirm → apply
- **Verify:** scripted e2e with `UNIFY_HOME=<tmp>` + fake skillshare binary on PATH (stub script emitting fixture outputs)

### M1-9 — `unify sync` + `unify status` commands
- **Files:** `apps/cli/src/commands/sync.ts`, `apps/cli/src/commands/status.ts`, golden output tests
- **Spec:** sync: load config → adapter.sync → write `last-sync.json` → print change table. status: build `UnifiedStatus` (skillshare targets + placeholder memory) → pretty table; `--json` raw
- **Tests:** golden table output (exact stdout match) + JSON shape test
- **Verify:** `bun test apps/cli`

### M1-10 — Contract pin
- **Files:** `testdata/skillshare/0.28.0/README.md`
- **Spec:** document how fixtures were recorded (commands + versions); CI runs all adapter tests against fixtures only (no network); if upstream changes output format → tests fail LOUD on purpose (upstream-churn radar)
- **Verify:** CI green, no network in tests (enforce via CI without egress to gh releases)

## Exit criteria
On a real machine: `unify init` detects tools, installs pinned skillshare, first sync ok → `unify sync` reflects in skillshare targets → `unify status` matrix correct → `unify doctor` clean.
