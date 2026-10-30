# Phase 2 Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Opt-in, per-item MCP and memory import, with secrets never copied.

**Architecture:** Two pure functions plus two thin citty commands, building on Phase 1 discovery (`MCP_CONFIGS`, JSON `mcpServers` parsing). No change to `unify sync` or Phase 1 `discover`.

**Tech Stack:** Bun + TypeScript, `bun test`, `bun run typecheck`, fixture homes in tests.

**Spec:** `docs/superpowers/specs/2026-10-31-discovery-import-design.md` (Phase 2 section).

## Global Constraints

- One item at a time, with a preview and a confirmation prompt unless `--yes` is passed explicitly.
- Secrets are never copied: MCP import strips `env`, `headers`, and any key containing token/key/secret/password/auth, recursively, and prints a warning that secrets must be re-entered in the target tool.
- MCP import in this PR is JSON-to-JSON only (Claude, Gemini, Cursor, Windsurf JSON configs). TOML (Codex) is explicitly unsupported, not guessed.
- Memory import is from a user-supplied text file, one entry, into the active profile's agentmemory namespace — it is not an automatic conversion of another tool's internal memory store, which has no verified format to convert from.
- TDD: failing test first for every behaviour.

## Review Focus

- A target MCP config that already has the server must not be overwritten.
- A secret hidden in a nested field must still be stripped, not just top-level `env`.
- An empty memory file must be rejected, not saved as an empty memory.
- Import must not modify the source config or source file.

---

### Task 1: MCP import function

**Files:**
- Create: `apps/cli/src/discovery/mcp-import.ts`
- Test: `apps/cli/src/discovery/mcp-import.test.ts`

**Interfaces:**
- Produces: `importMcpServer(opts: { server: string; fromPath: string; toPath: string }): Promise<{ server: string; hadSecrets: boolean; toPath: string }>`, throwing on missing source, missing server, existing target server, or non-JSON target.

- [ ] **Step 1: Write the failing test** — fixture source JSON with a server carrying `env: {TOKEN: "x"}`, `headers`, and a nested secret; fixture target JSON with another server. Assert imported definition has no secret values, other target servers are preserved, source is unchanged, and re-import throws.
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Implement `importMcpServer`** — recursive secret stripping, merge, 2-space JSON write, parent dir creation.
- [ ] **Step 4: Run test to verify it passes**
- [ ] **Step 5: Commit**

### Task 2: Memory import validation + commands

**Files:**
- Create: `apps/cli/src/commands/import-mcp.ts`, `apps/cli/src/commands/import-memory.ts`
- Modify: `apps/cli/src/index.ts`

**Interfaces:**
- Produces: `unify import-mcp <server> --from <tool> --to <tool> [--yes]`, `unify import-memory --file <path> [--concepts a,b] [--yes]`

- [ ] **Step 1: Write the failing test** — memory validation: empty file text rejected, non-empty text accepted with preview truncation. MCP command resolution: unknown tool, TOML tool, and JSON tool mapping are tested via the resolver helper.
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Implement both commands** — import-mcp: resolve JSON configs from `MCP_CONFIGS`, preview + confirm, call importMcpServer, warn about secrets. import-memory: read file, preview first 200 chars, confirm, save via agentmemory adapter into the active profile namespace (same setup as `unify memory save`).
- [ ] **Step 4: Run test to verify it passes**
- [ ] **Step 5: Commit, verify typecheck + full suite, push branch, open stacked PR with base `feature/discovery-import`**
