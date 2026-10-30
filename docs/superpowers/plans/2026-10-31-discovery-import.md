# Discovery + Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add read-only `unify discover` and explicit skills import (Phase 1), so a skill found in one provider can be shared to all providers via existing sync.

**Architecture:** A new pure discovery module under `apps/cli/src/discovery/` with no backend dependencies, plus two thin citty commands that wire it to skillshare's existing source dir and target paths. No change to `unify sync` behaviour.

**Tech Stack:** Bun + TypeScript, existing `bun test` / `bunx tsc --noEmit` checks, fixture homes in tests (never the real home).

**Spec:** `docs/superpowers/specs/2026-10-31-discovery-import-design.md`

## Global Constraints

- Discovery is read-only: it must not create, copy, or modify any file.
- Discovery output must never contain a secret value; MCP output is server names + config path + hasSecrets boolean only.
- Skills import copies (never symlinks) a directory, refuses name `skillshare`, refuses an existing destination, refuses path escape.
- Windows-safe: use `path.join` / tilde expansion, no shell, no POSIX-only assumptions in tests.
- TDD: failing test first for every behaviour, then minimal implementation.

## Review Focus

- A skill name containing `/` or `..` must not escape the source dir — import must reject it.
- A missing skills folder must be reported as missing, not crash discovery.
- An unparsable MCP config must be reported as unparsable, not silently skipped, and must not leak its contents.
- A skill already in the skillshare source must be reported as already-shared, not as importable.
- Import must not delete or modify the original tool's copy.

---

### Task 1: Discovery module — skills + MCP names

**Files:**
- Create: `apps/cli/src/discovery/index.ts`
- Test: `apps/cli/src/discovery/index.test.ts`

**Interfaces:**
- Consumes: `DEFAULT_SKILL_PATHS` from `../adapters/skillshare/tools`, `expandTilde` from `@unify/core`
- Produces: `discoverSkills(targets: { tool: string; skillsPath: string }[], sourceSkills: string[]): DiscoveredSkill[]`, `parseMcpJson(text: string): { names: string[]; hasSecrets: boolean }`, `parseMcpToml(text: string): { names: string[]; hasSecrets: boolean }`, `MCP_CONFIGS: { tool: string; rel: string; format: "json" | "toml" }[]`, `discoverMcp(home: string): Promise<McpFinding[]>`

- [ ] **Step 1: Write the failing test** — fixture home with a claude skills dir containing `my-skill/` and `skillshare/`, a gemini skills dir missing, a Claude JSON MCP config with two servers and an env key, and a Codex TOML config with one server. Assert discoverSkills marks my-skill importable and skillshare already-shared, missing dir is reported, MCP names are returned without any secret value in the result.
- [ ] **Step 2: Run test to verify it fails** — Run: `bun test apps/cli/src/discovery/index.test.ts` Expected: FAIL, module not found.
- [ ] **Step 3: Implement the discovery functions in `apps/cli/src/discovery/index.ts`** — directory listing only (no recursion into skill contents for Phase 1), JSON `mcpServers` keys, TOML `[mcp_servers.<name>]` headers, secret detection by key names (`env`, `headers`, `apiKey`, `token`, `password`, `secret`) only, never values.
- [ ] **Step 4: Run test to verify it passes** — Run: `bun test apps/cli/src/discovery/index.test.ts` Expected: PASS.
- [ ] **Step 5: Commit** — `git add apps/cli/src/discovery && git commit -m "feat(discovery): read-only skills + MCP-name discovery"`

### Task 2: Skills import

**Files:**
- Create: `apps/cli/src/discovery/import.ts` (or add to index.ts if the builder keeps it to one file — keep import separate for a clean boundary)
- Test: `apps/cli/src/discovery/import.test.ts`

**Interfaces:**
- Consumes: discovery module from Task 1
- Produces: `importSkill(opts: { name: string; fromDir: string; sourceDir: string }): Promise<{ dest: string }>`, throwing on invalid name, missing source, existing destination, or path escape.

- [ ] **Step 1: Write the failing test** — fixture source skill dir with a file, empty source dir, plus cases: name `../evil`, name `skillshare`, destination already exists. Assert copy succeeds with file contents intact and original untouched, and all three bad cases throw.
- [ ] **Step 2: Run test to verify it fails** — Expected: FAIL, module not found.
- [ ] **Step 3: Implement `importSkill`** — validate name with `/^[A-Za-z0-9][A-Za-z0-9._-]*$/` and reject `skillshare`, resolve dest under sourceDir and check it stays inside, use recursive copy.
- [ ] **Step 4: Run test to verify it passes**
- [ ] **Step 5: Commit**

### Task 3: CLI commands `discover` and `import-skill`

**Files:**
- Create: `apps/cli/src/commands/discover.ts`, `apps/cli/src/commands/import-skill.ts`
- Modify: `apps/cli/src/index.ts` (register both commands + help text)

**Interfaces:**
- Consumes: Task 1 + Task 2, skillshare adapter source dir (`path.join(home, ".config", "skillshare", "skills")`), `DEFAULT_SKILL_PATHS`
- Produces: `unify discover [--json]`, `unify import-skill <name> --from <tool>` (tool must be in DEFAULT_SKILL_PATHS; otherwise error naming the tool, not a guessed path)

- [ ] **Step 1: Write the failing test** — use the existing command test pattern in `apps/cli/src/commands/`; assert `discover` lists a fixture skill and `import-skill` copies it. If a command-level test is not feasible without the full registry, test the command's resolution helpers instead and verify the CLI manually in Task 4.
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Implement both commands** — discover: targets = skillshare managed targets if available, else DEFAULT_SKILL_PATHS entries; import-skill: resolve fromDir, call importSkill, print dest + "run `unify sync` to distribute it".
- [ ] **Step 4: Run test to verify it passes**
- [ ] **Step 5: Commit**

### Task 4: Verification + branch finishing

**Files:** none new, except the plan/design already committed.

- [ ] **Step 1: Run full checks** — `bun run typecheck` (or repo equivalent), `bun test apps/cli/src/discovery apps/cli/src/adapters/skillshare` — Expected: all pass except pre-existing failures already known (server.test.ts memory-startup 500-vs-503, verified pre-existing on clean main).
- [ ] **Step 2: Manual CLI check in a fixture home** — build CLI, run `discover` against a temp home with a fake claude skill, run `import-skill`, run `sync --dry-run` to show the imported skill now appears as a source skill.
- [ ] **Step 3: Push branch + open PR** — branch `feature/discovery-import`, PR body: Phase 1 only, what discovery does/does not do, secrets policy, Phase 2 explicitly out of scope.
- [ ] **Step 4: Report to user** — what was built, exact commands to try on Windows, and that Phase 2 (opt-in MCP/memory) is next, not in this PR.
