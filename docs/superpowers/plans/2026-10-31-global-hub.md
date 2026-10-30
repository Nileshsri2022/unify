# Global Hub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a global hub under `unifyHome/global` with per-provider subdirs, `hub collect`, `hub sync` (collect then distribute), and a detection-only watcher.

**Architecture:** A new module `apps/cli/src/global-hub/` reusing Phase 1 discovery and Phase 2 MCP stripping/import logic, plus one citty `hub` command with subcommands. No change to `unify sync`.

**Tech Stack:** Bun + TypeScript, `bun test`, `bun run typecheck`, fixture homes.

**Spec:** `docs/superpowers/specs/2026-10-31-global-hub-design.md`

## Global Constraints

- Hub root is `path.join(unifyHome, "global")`, never a hardcoded username.
- Collect writes to the hub only, never to a provider.
- Distribute never overwrites an existing skill or MCP server; collisions are skipped and reported.
- Hub MCP files never contain secrets; hadSecrets goes in `mcp-meta.json`.
- Deduplicate by physical skills path (shared `~/.agents/skills` collected once).
- TDD: failing test first for every behaviour.

## Review Focus

- A provider sharing a physical skills path must not produce duplicate hub copies.
- A secret in a nested MCP field must still be stripped in the hub file.
- A distribute collision must be skipped, not overwritten, and reported.
- A missing provider folder must be reported as missing, not crash collect.
- Watcher must not apply changes by itself.

---

### Task 1: Hub collect (skills + MCP)

**Files:**
- Create: `apps/cli/src/global-hub/index.ts`
- Test: `apps/cli/src/global-hub/index.test.ts`

**Interfaces:**
- Produces: `hubRoot(unifyHome: string): string`, `collectSkills(hubRoot: string, targets: { tool: string; skillsPath: string }[]): Promise<{ provider: string; skills: string[]; state: string }[]>`, `collectMcp(hubRoot: string, home: string): Promise<McpCollect[]>`

- [ ] **Step 1: Write the failing test** — fixture home with claude skills `a/` and codex skills sharing the same physical dir as a second provider entry; fixture Claude MCP JSON with a secret. Assert hub has `claude/skills/a/`, shared path collected once, hub MCP has no secret value, meta says hadSecrets.
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Implement collect** — copy skills (recursive), strip MCP secrets via Phase 2 logic, write `mcp.json` + `mcp-meta.json`, dedupe by resolved physical path.
- [ ] **Step 4: Run test to verify it passes**
- [ ] **Step 5: Commit**

### Task 2: Hub distribute + watcher

**Files:**
- Modify: `apps/cli/src/global-hub/index.ts`
- Test: `apps/cli/src/global-hub/index.test.ts` (extend), `apps/cli/src/global-hub/watch.test.ts`

**Interfaces:**
- Produces: `distributeSkills(hubRoot: string, targets: { tool: string; skillsPath: string }[]): Promise<{ provider: string; skill: string; action: "linked" | "skipped" }[]>`, `distributeMcp(hubRoot: string, home: string): Promise<...>`, `watchHub(hubRoot: string, onChange: (provider: string) => void): { close(): void }`

- [ ] **Step 1: Write the failing test** — hub with a skill in claude, empty gemini folder, and a colliding skill in cursor. Assert distribute copies to gemini, skips cursor, and reports both. Watcher: write a file under a provider dir and assert the callback fires with that provider (with a timeout, not a fixed sleep).
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Implement distribute + watcher** — distribute reuses copy/merge logic, never overwrites; watcher uses `node:fs watch` per provider dir, debounced 300 ms, detection only.
- [ ] **Step 4: Run test to verify it passes**
- [ ] **Step 5: Commit**

### Task 3: CLI `hub` command + verification

**Files:**
- Create: `apps/cli/src/commands/hub.ts`
- Modify: `apps/cli/src/index.ts`

**Interfaces:**
- Produces: `unify hub collect`, `unify hub sync` (collect then distribute), `unify hub watch`

- [ ] **Step 1: Build CLI, manual fixture test** — fixture HOME with claude skill + MCP, run `hub collect`, inspect hub, run `hub sync`, verify gemini/cursor received the skill/MCP without secrets.
- [ ] **Step 2: Run typecheck + full suite** — Expected: all pass (except any pre-existing failures already known).
- [ ] **Step 3: Push branch + open PR** — branch `feature/global-hub`, PR body: hub layout, watcher detection-only, memory snapshot-only, dashboard Sync integration out of scope.
