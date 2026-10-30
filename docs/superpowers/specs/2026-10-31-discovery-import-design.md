# Discovery + Import Design (Phase 1, then Phase 2)

## Intent and why
Today `unify sync` is one-way: it pushes the skillshare skill out to every
detected tool. It never pulls anything back. A user who already has skills,
plugins, MCP servers, and memories in Claude, Codex, Gemini, Cursor,
Windsurf, Copilot, Cline, Antigravity, and the other detected providers
gets none of that into unify, and none of it shared with the other tools.

This design makes Sync two-way, in the order the user approved:
Phase 1 (safe first) first, Phase 2 (opt-in) only after Phase 1 works.

## Goals
- Phase 1, read-only discovery: `unify discover` scans every provider's
  default locations and reports what it found — skills, plugins, MCP
  server names, and memories — with **no changes made** to any tool.
- Phase 1, skills import: a skill found in one provider (e.g. Claude)
  can be imported into the skillshare source, after which a normal
  `unify sync` distributes it to all other providers.
- Phase 2, opt-in import: MCP servers and memories can be imported
  **one item at a time, with the user's approval per item**, never
  in bulk and never silently.
- All providers, not one: discovery covers every skillshare-managed
  target plus every tool unify detects, not just Claude/Codex.

## Non-goals / anti-goals
- No bulk, silent, or automatic import of MCP or memory. A design that
  auto-copies MCP configs or memories across tools would be a failure
  even if it technically works, because MCP configs carry secrets and
  memories are profile-scoped and format-specific.
- No change to the existing one-way sync behaviour. Discovery and
  import are new commands; `unify sync` keeps doing exactly what it
  does today unless the user first imports a skill into the source.
- No new backend, no new pinned version, no dashboard rewrite in
  Phase 1. Dashboard surfacing of discovery is a follow-up, not
  Phase 1.

## Constraints
- Built the superpowers way: brainstorming (this doc) -> writing-plans
  -> TDD (failing test first, no production code without one) ->
  verification before completion -> branch finishing (PR).
- Existing code to build on: `apps/cli/src/adapters/skillshare/tools.ts`
  (`DEFAULT_SKILL_PATHS`, `KNOWN_TOOLS`, `detectInstalledTools`),
  `apps/cli/src/adapters/skillshare/index.ts` (skillshare `target list`
  gives each managed target's skills path; `listSourceSkills` lists the
  skillshare source), `apps/cli/src/commands/sync.ts` (sync flow),
  `apps/cli/src/index.ts` (citty command registration).
- Windows is the user's real machine: paths must expand `~` to the
  user's home on Windows too, and must not assume POSIX symlinks or
  shell tools. Tests must run on the VM and be Windows-safe.
- Secrets: discovery output must never print a secret value — MCP
  server *names* and config paths only, plus a boolean "has secrets"
  flag where a config contains env/headers/args that could hold keys.
  Full values are never copied, logged, or put in a PR, test, or doc.
- Memory: agentmemory is unify's own store (profile namespace =
  agentId). Other tools' memories are in different formats and places;
  importing them is a conversion, not a file copy, and must not
  duplicate or pollute the active profile's namespace.

## Approaches considered
1. **Extend `unify sync` itself to import first, then sync (rejected).**
   Trade-off: it changes the behaviour users already rely on, and a
   sync that silently pulls in unknown skills/plugins/MCPs is exactly
   the unsafe bulk import this design avoids. It also makes
   dry-run/apply semantics confusing.
2. **New read-only `unify discover` + explicit `unify import` (chosen).**
   Trade-off: one extra command to learn, but discovery is provably
   side-effect-free, import is explicit and per-item, and the existing
   sync path is untouched. This is the approach the user approved:
   Phase 1 = discover + skills import, Phase 2 = opt-in MCP/memory.
3. **Dashboard-only discovery (rejected for Phase 1).**
   Trade-off: the dashboard already has a Sync page, but a CLI-first
   implementation is testable, scriptable, and works on the user's
   Windows terminal without a running `unify ui`. Dashboard surfacing
   can reuse the same discovery module later.

## The parts decided, as decided
- Phase 1 discovery sources, in order:
  - Skills: each managed target's skills path (from skillshare
    `target list`, falling back to `DEFAULT_SKILL_PATHS`), listing
    directory entries, excluding the `skillshare` entry itself.
    A skill present in the skillshare source already is reported
    as "already shared", not as "found".
  - Plugins: only plugin locations unify can name with confidence
    per tool; other tools report "unknown location", never a guessed
    path. No invented plugin paths.
  - MCP: only server *names* from known per-tool config files
    (e.g. Claude, Codex, Gemini, Cursor, Windsurf config locations
    where they exist on that machine); a config that is absent or
    unparsable is reported as such, not silently skipped.
  - Memories: unify's own agentmemory total + per-profile namespaces
    (work/personal) as known; other tools' memories are reported as
    "tool-specific, conversion required" in Phase 1, not imported.
- Phase 1 skills import: copy (not symlink) the discovered skill
  folder into the skillshare source directory, refusing if the name
  is `skillshare`, already exists in the source, or escapes the
  source directory. After import, the next `unify sync` distributes
  it like any other source skill. Import never deletes or modifies
  the original tool's copy.
- Phase 2 MCP import: per-server, user-approved, with secrets
  re-entered by the user (or left blank) — never copied verbatim
  from the source config. Phase 2 memory import: per-memory,
  user-approved, converted into the active profile's agentmemory
  namespace, with a dry-run preview of what would be added.
- Commands (builder's call on exact flags, decided shape):
  `unify discover [--json]` (read-only) and an explicit import
  command for a single named skill/server/memory. `unify sync`
  is unchanged.

## What's left to the builder
- Exact per-tool plugin/MCP config paths on Windows vs POSIX, with
  tests using fixture homes (never the real home) for each path.
- Exact CLI flag names and output format for `discover` (human
  table by default, `--json` for scripting), following the existing
  `renderSync` style.
- The writing-plans doc: task list, files, and failing tests, per
  superpowers writing-plans, before any production code.
- Dashboard surfacing of discovery results: explicitly out of
  Phase 1 scope; do not add it to this branch.
