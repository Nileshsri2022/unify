# Cross-Platform Test Suite + CI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** All 205 tests pass on Windows (and Linux), and a GitHub Actions matrix runs typecheck + tests on ubuntu-latest and windows-latest.

**Architecture:** Production code is already Windows-correct (verified: CLI builds and runs `version`/`status`/`doctor` on Windows). The 51 failing tests fail because their harnesses are POSIX-only: shebang shell scripts spawned directly, `new URL().pathname` as a filesystem path, host-OS `path.join` for another platform's paths, hardcoded `/home/u` / `/tmp/u` expectations, and `chmod` assertions. The fix replaces scripted stubs with **compiled host stubs** (`bun build --compile`, ~2s each, verified working and PATH/PATHEXT-resolvable on Windows), uses the production `SKILLSHARE_BIN` / npm-`.bin`-shim + `dist/cli.mjs` seams the real code already provides, and makes the two take-`platform`-parameter path helpers honor the *target* platform's separators.

**Tech Stack:** Bun 1.4.4, TypeScript strict, bash on POSIX / node 26 on Windows for the agentmemory entry shim, GitHub Actions.

**Spec:** This plan. Baseline facts verified on 2026-10-30 (D:\vscode_programs\unify, HEAD `721f90f`, clean tree): `bun run typecheck` passes; 154/205 tests pass; failures analyzed per-file; `bun build --compile` produces a runnable `.exe` in ~2s; `Bun.spawn(["fake-tool"])` resolves via PATH+PATHEXT on Windows; `node --version` = v26.12.1.

## Global Constraints

- Bun + TypeScript (strict) — match surrounding code style (tabs, double quotes).
- No new runtime dependencies. Test helpers live under `apps/cli/test/` (already used by tests via relative import and typechecked by `apps/cli/tsconfig.json`).
- Every spawned test child must be fully isolated from the real user home: `HOME`/`USERPROFILE` inside the test root, `APPDATA`/`XDG_CONFIG_HOME` inside the test root, and `UNIFY_SKIP_ENGINE_INSTALL=1` whenever agentmemory's ensureServer runs in a stub env (otherwise Windows downloads the real 90MB `iii.exe` — observed during diagnosis: `~/.agentmemory/bin/iii.exe` appeared mid-run).
- Do not change test *intent*: same assertions about stdout tables, shapes, and error text; only the mechanism (stub binaries, path construction, env) becomes cross-platform.
- Never spawn a shebang script directly on Windows; never rely on `new URL(x).pathname` for local paths — use `fileURLToPath`.

## Review Focus

- **Real-user-home leakage** — no test may read/write `~/.agentmemory`, `~/.unify`, or real `%APPDATA%`. Pinned by: `UNIFY_SKIP_ENGINE_INSTALL=1` + home/APPDATA overrides in every spawned-child env (Tasks 5–7); the `profile-e2e` yaml round-trip (already covers rewrite isolation).
- **`ensureEngine` verify vs. cross-platform install** — installing an engine for a *target* platform on a host that cannot run it must succeed (path + extraction), not throw `verify`. Pinned by: Task 2's updated `ensureEngine` tests running on both hosts (win32-zip test on ubuntu, linux-tar test on windows).
- **`SKILLSHARE_BIN` precedence stabilizes detection** — e2e children resolve the stub via the documented precedence (`explicit > env > managed > PATH`); the registry lazy-resolution test pins that managed-dir detection still works (Task 4).
- **Compiled stub name portability** — Linux execs an ELF regardless of its name (so a `skillshare.exe`-named ELF fixture runs there); Windows requires the `.exe` name. All fixtures named with `skillshareBinName(platform)` / payload-from-host compiled stubs; pinned by Task 4's `resolveSkillshareBinary` tests.

---

### Task 1: Platform-aware path helpers (prod, parameterized paths)

**Files:**
- Modify: `apps/cli/src/adapters/skillshare/index.ts:57-70` (`skillshareConfigPaths`)
- Modify: `apps/cli/src/adapters/agentmemory/engine.ts:110-116` (`engineInstallPath`), `engine.ts:319-333` (`ensureEngine` verify step)
- Test: `apps/cli/src/adapters/skillshare/status.test.ts:252-267`, `apps/cli/src/adapters/agentmemory/engine.test.ts:57-64`, `103-119`

**Interfaces:**
- Produces: `skillshareConfigPaths(home, env, platform)` — for non-win32 `platform` joins with `path.posix.join`, for win32 with `path.win32.join` (behavior for the *host* platform is unchanged). Same for `engineInstallPath(home, platform)`.
- Produces: `ensureEngine` runs the post-install `--version` verify **only when `platform === process.platform`** (installing for another platform on this host skips the run-check and returns `{installed: true, path}` with `version: undefined`). Comment explains why (a posix host testing the win32 shape cannot exec it; exec bit is still chmod'd).

- [ ] **Step 1: Update the two failing unit tests to pin the new contract**

`engine.test` "binary name and install path match where agentmemory looks": keep `path.win32.join("C:\\Users\\n", ".agentmemory", "bin", "iii.exe")` expectation; change the linux expectation to `"/home/u/.agentmemory/bin/iii"` exactly (covers a win32-host run). `status.test` "unix: ~/.config or $XDG_CONFIG_HOME" keeps its current `/home/u/.config/skillshare/config.yaml` expectations verbatim.

- [ ] **Step 2: Run** `bun test ./apps/cli/src/adapters/skillshare/status.test.ts ./apps/cli/src/adapters/agentmemory/engine.test.ts`
Expected: still FAIL (prod not fixed yet).

- [ ] **Step 3: Implement** both helpers with a `const join = platform === "win32" ? path.win32.join : path.posix.join` local; in `ensureEngine`, guard the final `engineVersion(binPath)` call with `platform === process.platform` (keep the `log` note when skipping).

- [ ] **Step 4: Run** same command.
Expected: "unix: ~/.config…" and "binary name and install path…" PASS; no other test in those files changes outcome.

- [ ] **Step 5: Commit** `git commit -m "fix(adapters): honor target-platform separators in parameterized path helpers; skip cross-host engine verify"`

### Task 2: Shared host-stub helpers (`apps/cli/test/stubs.ts`)

**Files:**
- Create: `apps/cli/test/stubs.ts`
- Reuse: `apps/cli/testdata/skillshare/0.28.0/*` (fixtures)

**Interfaces:**
- ```ts
  export function fp(url: URL): string              // Bun.fileURLToPath
  export async function compileStub(name: string, source: string): Promise<string>
  // Writes source to <tmpdir>/unify-stubs/<name>.ts, compiles `bun build --compile`
  // → executable at <tmpdir>/unify-stubs/<name> (auto .exe on win32), returns the path.
  // In-process cache keyed by `${name}:${source}` so repeated calls don't recompile.
  ```
  Sources are plain Bun TS: use `process.argv`, `process.env`, `console.log/error`, `Bun.write`, `await Bun.sleep`, `Bun.serve`, `process.execPath`-free (no self-path reads needed).
- ```ts
  export function skillshareStubSource(): string
  // Reads the fixture files from testdata/skillshare/0.28.0 at call time and
  // embeds their contents as a JSON map. Behavior:
  //   --version            → print FIXTURES["version.out"]
  //   target list          → print FIXTURES["target-list.out"]
  //   sync --dry-run --json → print FIXTURES["sync-dryrun.json"]
  //   sync --json          → print FIXTURES["sync-apply.json"]
  //   init --no-copy --all-targets → mkdir($HOME/.config/skillshare) + write
  //     config.yaml (empty file), print "✓ initialized"
  //   target add *         → print "✓ Added target"
  //   sync --dry-run --list... any other argv → stderr "stub: unhandled: <argv>" exit 1
  // If $SH_CALL_LOG is set, append the argv joined with " " + "\n" to that file.
  ```
  (Existing callers delete `$HOME/.config/skillshare` before `init` — the stub recreating it matches today's bash stub exactly.)
- ```ts
  export function amStubEntry(): string
  // The agentmemory fake CLI as an ESM bundle (runs under `node`):
  //   default (no args/start): serve STUB_PORT on 127.0.0.1:
  //     /agentmemory/livez  → 200 {"service":"agentmemory","status":"ok","viewerPort":0}
  //     auth Bearer <secret from (process.env.HOME ?? homedir)/.agentmemory/secret — create with "stub-secret-123" if absent>
  //     /agentmemory/health → {"status":"healthy","version":"0.9.31"}
  //     /agentmemory/status → {"index":{"memoriesIndexed": store.length}}
  //     /agentmemory/remember → store push ({id:"mem_stub_"+n, content, concepts, agentId}) → 200
  //     /agentmemory/smart-search → substring match on content lowercased,
  //       scoped to body agentId when present, limit d.limit||10 → results [{obsId, score:1, title, type:"fact"}]
  //     else 404 {"error":"not found"}
  //   writes pid into ($STUB_STATE)/server.pid; never exits
  //   "init" → mkdir($HOME/.agentmemory) + touch $HOME/.agentmemory/.env
  //   "stop" → kill pid from $STUB_STATE/server.pid (ignore missing), echo "stopped (stub)"
  ```
- ```ts
  export async function writeAgentmemoryStub(unifyHome: string): Promise<void>
  // Writes the real package's dual shape:
  //   backends/agentmemory/node_modules/.bin/agentmemory  ← POSIX shim:
  //     #!/bin/sh
  //     exec node "$(dirname "$0")/../@agentmemory/agentmemory/dist/cli.mjs" "$@"
  //   (chmod 0o755 when host is not win32)
  //   backends/agentmemory/node_modules/@agentmemory/agentmemory/dist/cli.mjs ← amStubEntry()
  //     (plus package.json {"name":"@agentmemory/agentmemory","version":"0.9.31"} at the pkg root,
  //      preserving what callers already write)
  // Windows spawns `node cli.mjs` (agentmemoryArgv) — no exec bit needed.
  ```
- ```ts
  export function cliEnv(o: {
    home: string
    unifyHome: string
    // Agentmemory stub wiring — when set, AGENTMEMORY_URL/STUB_PORT/STUB_STATE are added.
    stub?: { port: number; state: string }
  }): Record<string, string>
  ```

- **Child env contract (all Task 5/6 spawned processes):** always `...process.env`, then force:
  - `HOME`, `USERPROFILE` = `o.home` (real-user-home leakage must be impossible)
  - `APPDATA` = `<home>/AppData/Roaming` ; `XDG_CONFIG_HOME` = `<home>/.config` (isInitialized/agentmemory data-dir resolution reads these)
  - `UNIFY_HOME` = `o.unifyHome` ; `UNIFY_SKIP_ENGINE_INSTALL` = `"1"` (Windows otherwise downloads the real 90MB `iii.exe` before the stub is reachable)
  - `SKILLSHARE_BIN` = compiled-fixture stub path (Task 5 callers only)
  - when `o.stub`: `AGENTMEMORY_URL` = `http://127.0.0.1:<port>`, `STUB_PORT`, `STUB_STATE`

- [ ] **Step 1:** implement per signatures above; run `bun run typecheck` (helper must typecheck under `apps/cli/tsconfig.json`).
- [ ] **Step 2:** Commit `git commit -m "test(cli): add cross-platform host-stub helpers"`

### Task 3: agentmemory adapter tests cross-platform

**Files:**
- Test: `apps/cli/src/adapters/agentmemory/index.test.ts:108`
- Test: `apps/cli/src/adapters/agentmemory/engine.test.ts` (ensureEngine describe + probeEngineAsAgentmemory describe)
- Test: `apps/cli/src/adapters/agentmemory/server.test.ts` (stubs for lifecycle + failure tests)
- Modify: `apps/cli/src/adapters/agentmemory/engine.ts` `binPath`-verify behavior if Step 1 shows a remaining host-dependent failure

**Interfaces:**
- Consumes: `compileStub`, `fp` from Task 2.
- Produces: in `engine.test`, a beforeAll-compiled `iii` stub whose behavior is env-selected: `UNIFY_TEST_III_MODE` unset→ print `0.25.0` to stdout exit 0; `stderr`→ stdout+stderr print, stderr `0.25.0`, exit 0; `slow`→ `await Bun.sleep(5000)` before printing; `exit1`→ print `0.25.0`, exit 1. Compile ONCE (name `iii-host`) — probes instantiate per-behavior copies by compiling 1× extra names? No: reuse same cached exe; behavior via env is fine because env is inherited by the spawned probe child.

- [ ] **Step 1:** `index.test.ts:108` → `expect(det.path).toContain(path.join("backends", "agentmemory"))`; run file → PASS.
- [ ] **Step 2:** `engine.test` — replace every `mk(...)` script payload and `BIN`-named archive member:
  - probe tests: `mk` → use the compiled stub path; set `process.env.UNIFY_TEST_III_MODE` per test in a try/finally restore; "missing binary" test unchanged.
  - ensureEngine win32 test: archive member `{name:"iii.exe", data: stubBytes}` where `stubBytes = await Bun.file(await compileStub("iii-host", III_STUB_SOURCE)).arrayBuffer()`.
  - ensureEngine linux test: member `{name:"iii", data: stubBytes}`; expectation → `path.posix.join(home, ".agentmemory", "bin", "iii")`.
  - "already installed and runnable → no download": replace shell script with stub exe named `engineBinName(process.platform)` (`iii.exe` on win32 / `iii` on posix), `platform: process.platform`, drop the `return` early-out; assert `version` contains `0.25.0`.
- [ ] **Step 3:** `server.test` — replace the bash `agentmemory-fake` with `compileStub("am-fake", amFakeSource())` where source behavior is argv/env-driven:
  - `stop` subcommand (pid from `FAKE_STATE`), default: supervisor server mode — livez on `FAKE_PORT`, writes pid to `FAKE_STATE/server.pid`, stays alive.
  - `noop` (stays alive, silent 30s), `dies` (stderr `boom: iii-engine missing`, exit 3), `hangs` (stdout `■  Could not start iii-engine.`, stays alive) implemented as env `AMFAKE_MODE` values (default server). Calls to `ensureRunning`/`stop` for noop/dies/hangs add `env: { AMFAKE_MODE: "..." }`; assert messages stay byte-identical.
  - Delete `mock-server.js`/`server.js` fixture writes; keep `shell.js`-free.
- [ ] **Step 4:** run `bun test ./apps/cli/src/adapters/agentmemory`. Expected: all PASS on Windows (and on Linux by CI matrix later).
- [ ] **Step 5:** Commit `git commit -m "test(agentmemory): pos-sh stubs → compiled host stubs; entryPath covers win32 argv"`

### Task 4: skillshare adapter tests cross-platform

**Files:**
- Test: `apps/cli/src/adapters/skillshare/install.test.ts`
- Test: `apps/cli/src/adapters/registry.test.ts`

**Interfaces:**
- Consumes: `compileStub` from Task 2 with source `console.log("skillshare v0.28.0")` (name `sh-host`).
- Produces: fixtures whose member content is the compiled host stub bytes so `install(...)`'s extract + real spawn + `--version` check runs on every host.

- [ ] **Step 1:** in `install.test` beforeAll, add `stubBytes = await Bun.file(await compileStub("sh-host", 'console.log("skillshare v0.28.0")')).arrayBuffer()`. Replace every `#!/bin/sh\necho "skillshare v0.28.0"` payload (tarball contents, zip member data) with `stubBytes`. Keep member names (`skillshare` / win32-named member).
- [ ] **Step 2:** in "ok path" test (tar.gz → POSIX-named member): add `test.skipIf(process.platform === "win32")` (Windows cannot exec the extensionless member — covered for Windows by the zip-shape test which uses the host bin name). Convert "zip asset" test to use member name `skillshareBinName()` (already does) and payload `stubBytes` (now runs on both hosts). The "win32 target" test already uses `skillshare.exe` member + resolves win32 — now passes on both hosts. Adjust the "win32 target" zip member payload to stubBytes; delete its inner `path.join`-no-`/` assumptions if any fail.
- [ ] **Step 3:** in `registry.test`: drop the `test.skipIf(process.platform === "win32")` wrapper from the late-installed test by writing the managed-dir fixture as a HOST-compiled stub (bytes via `Bun.file(compileStub("sh-host", 'console.log("skillshare v0.28.0")')).arrayBuffer()`) named `skillshareBinName()` → both tests now run everywhere. Remove the `chmod`-mode assertion in `registry.test` (0700 assertions are POSIX-only) — keep the plain `writeFile(bin, stubBytes)`.
- [ ] **Step 4:** run `bun test ./apps/cli/src/adapters/skillshare ./apps/cli/src/adapters/registry.test.ts` → PASS.
- [ ] **Step 5:** Commit `git commit -m "test(skillshare): host-runnable fixture binaries; registry late-install test goes cross-platform"`

### Task 5: Command e2e tests (profile / memory / skillshare init, status, sync, doctor / glue)

**Files:**
- Test: `apps/cli/src/commands/e2e.test.ts`
- Test: `apps/cli/src/commands/profile-e2e.test.ts`
- Test: `apps/cli/src/commands/memory-e2e.test.ts`
- Test: `apps/cli/src/commands/glue-e2e.test.ts`

**Interfaces:**
- Consumes: `compileStub`, `skillshareStubSource`, `writeAgentmemoryStub`, `cliEnv`, `fp` from Task 2.
- Produces: identical local `run(args, ...)` shape per file, but with:
  - `cliEntry = fp(new URL("../index.ts", import.meta.url))` (fixes profile-e2e outright; the only Windows breakage there)
  - child env via `cliEnv({...})` + per-file extras (`SKILLSHARE_BIN`, `SH_CALL_LOG`, `SH_FIXTURES`-equivalents, ports)
  - the skillshare stub resolved via `SKILLSHARE_BIN = await compileStub("skillshare", skillshareStubSource())` (SKILLSHARE_BIN is documented precedence in `resolveSkillshareBinary`), NOT via PATH (drop the PATH prepend + bash stub; `PATH` no longer patched).
  - ` deleteUserFixture` none — keep fixture assertions byte-identical (jq-precise stdout tables).

- [ ] **Step 1 (profile-e2e):** swap `.pathname` → `fp(...)`; run file → all 6 PASS (no stubs needed).
- [ ] **Step 2 (memory-e2e):** delete the bash `stub` + `mock-server.js` writing; call `await writeAgentmemoryStub(unifyHome)`; `run()` env from `cliEnv` with `stub: { port, state: stateDir }` (and no PATH patching). Keep test text/argv identical.
- [ ] **Step 3 (glue-e2e):** same as Step 2 + `SKILLSHARE_BIN` stub; AGENTS.md snapshot assertions unchanged. Delete its inline skillshareStub string + mockServer strings.
- [ ] **Step 4 (e2e.test):** same as Step 3's skillshare-only treatment (`run()` env gains `SKILLSHARE_BIN`; no PATH patching; `fileURLToPath` everywhere). Keep stdout-table assertions byte-for-byte.
- [ ] **Step 5:** each file: `bun test ./apps/cli/src/commands/<file>.test.ts` → PASS individually.
- [ ] **Step 6:** Commit `git commit -m "test(commands): e2e harness cross-platform (fileURLToPath, SKILLSHARE_BIN, node-entry agentmemory stub)"`

### Task 6: `ui/server.test.ts` + core state paths + cleanup

**Files:**
- Test: `apps/cli/src/ui/server.test.ts` (beforeAll rewrite: fake-dist + real handler wiring stays)
- Test: `packages/core/src/state.test.ts`

- [ ] **Step 1:** `state.test` — every `pathsFor("/tmp/u")` expectation: replace string equality with `path.join("/tmp/u", ...)`, `path.join(...)` autogen? No — rewrite the six toMatchObject lines with `path.join("/tmp/u", "unify.yaml")` etc. ("keep POSIX separators only when posix.t" is the OS's native behavior — `pathsFor` mirrors its host join); `ensureHome` chmod: `expect(homeStat.mode & 0o777).toBe(0o700)` wrapped in `test.if` (skip on win32 with a comment; directory existence asserts stay).
- [ ] **Step 2:** `server.test` beforeAll — replace the bash `skillshareStub` block with `const skillshareBin = await compileStub("skillshare", skillshareStubSource())` and pass `skillshareBinPath: skillshareBin`. Replace the agentmemory npm .bin shim + mock-server with `await writeAgentmemoryStub(unifyHome)`; drop the separate mock-server "node" re-locate. Handler opts: `serverEnv: { STUB_PORT: String(port), STUB_STATE: stateDir, UNIFY_SKIP_ENGINE_INSTALL: "1" }`.
- [ ] **Step 3:** "engine missing → 503" test's handler: keep the missing `.bin` (don't writeAgentmemoryStub) → on every host supervisor spawn fails fast; also pass `serverEnv: { UNIFY_SKIP_ENGINE_INSTALL: "1" }` (vaults away any real `iii.exe`/network). Existing 503 assertions remain byte-identical.
- [ ] **Step 4:** run `bun test ./apps/cli/src/ui/server.test.ts ./packages/core/src/state.test.ts` → PASS.
- [ ] **Step 5:** Commit `git commit -m "test(ui/core): API contract tests ported to host stubs; state paths POSIX-safe"`

### Task 7: Full suite green + CI matrix

**Files:**
- Create: `.github/workflows/test.yml`
- Modify: `README.md` (add a one-line QA/CI note in Layout section)

- [ ] **Step 1:** run `bun test packages/core apps/cli apps/dashboard/src/lib` ten times on this machine (Windows): 205/205 PASS, no flaky same-value retries (timeout budget grows by ~15s from stub compiles; that's fine).
- [ ] **Step 2:** `.github/workflows/test.yml`:
  ```yaml
  name: tests
  on:
    push: { branches: [main] }
    pull_request:
  jobs:
    test:
      strategy:
        fail-fast: false
        matrix: { os: [ubuntu-latest, windows-latest] }
      runs-on: ${{ matrix.os }}
      steps:
        - uses: actions/checkout@v4
        - uses: oven-sh/setup-bun@v2
        - run: bun install --frozen-lockfile
        - run: bun run typecheck
        - run: bun test packages/core apps/cli apps/dashboard/src/lib
  ```
- [ ] **Step 3:** README: under Layout section add one line `Cross-platform QA: tests + typecheck run the same way on Windows and Linux (see .github/workflows/test.yml).` — no other prose changes.
- [ ] **Step 4:** Commit `git commit -m "ci: ubuntu+windows matrix for typecheck + tests"`.

---

## Post-completion verification

1. `bun run typecheck` → clean.
2. `bun test packages/core apps/cli apps/dashboard/src/lib` on Windows → 205/205 PASS.
3. `bun run build:cli && ./apps/cli/dist/unify.exe status --json | head -c 300` → still healthy (regression guard).
4. Push branch; CI matrix green on both OSes.
