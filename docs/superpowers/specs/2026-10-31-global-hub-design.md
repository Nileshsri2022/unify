# Global Hub Design

## Intent and why
Phase 1/2 made import explicit and per-item, but there is still no
single place where a user can see everything unify knows about, across
all providers. The user asked for one global directory under their
home, with a per-provider subdirectory for skills, MCP, and memory,
a watcher on that directory, and Sync updating all providers from it.

## Goals
- One global hub root, resolved from the OS home — never a hardcoded
  username: `path.join(unifyHome, "global")`, i.e.
  `C:\Users\<user>\.unify\global` on Windows, `~/.unify/global` elsewhere.
- Per-provider subdirectories: `global/<provider>/skills/<skill>/`,
  `global/<provider>/mcp.json` (mcpServers only, secrets stripped),
  `global/memory/<profile>.json` (see Memory below).
- `hub collect`: mirror each provider's real location into its hub
  subdir. Writes to the hub only, never to a provider.
- `hub sync`: collect first, then distribute hub contents to every
  other provider. This is the CLI equivalent of the dashboard Sync
  button for the hub; dashboard integration is a follow-up.
- Watcher: detection only. While running, it reports which provider
  subdir changed (debounced). It does not auto-apply to providers.

## Non-goals / anti-goals
- No auto-apply from watcher. Auto-apply could overwrite a provider's
  own change or copy a secret.
- No overwriting a provider's existing native skill or MCP server.
  Collisions are reported as skipped, never overwritten or pruned.
- No secrets in the hub. MCP hub files contain stripped definitions
  only, with a `hadSecrets` flag per server.
- No dashboard rewrite in this PR. Dashboard Sync integration is
  explicitly out of scope; CLI `hub sync` proves the hub first.

## Constraints
- Built the superpowers way: design -> plan -> TDD -> verification -> PR.
- Build on existing code: `DEFAULT_SKILL_PATHS` + skillshare
  `target list` for skills paths, `MCP_CONFIGS` for MCP configs,
  `importMcpServer` stripping logic, `importSkill` copy logic.
- Windows-safe: `path.join`, tilde expansion from `os.homedir()`,
  no shell, no POSIX-only watcher assumptions. `fs.watch`
  recursive is not portable (macOS/Windows only), so the watcher
  watches each provider subdir individually and degrades to
  top-level change reporting on Linux.
- Shared physical paths: Codex/Goose/Zed/`universal` share
  `~/.agents/skills`. Hub collect deduplicates by physical skills
  path: the same folder is collected once, and providers sharing
  it are listed together, not copied three times.

## Approaches considered
1. **Hub as a symlink farm (rejected).** Symlinks from hub to
   provider folders look elegant, but on Windows symlinks need
   privileges, and a deleted provider folder would break the hub.
   Copies are explicit, portable, and testable.
2. **Hub collect + distribute, watcher detection-only (chosen).**
   Trade-off: one extra command to learn, but collect is safe
   (hub-only writes), distribute is explicit (Sync), and the
   watcher cannot cause data loss by itself.
3. **Watcher auto-applies on change (rejected).** Trade-off: faster
   feedback, but unsafe for the reasons in Non-goals. A user who
   wants auto-apply can run `hub sync` after the watcher reports
   a change, or a future opt-in flag can add it with the same
   collision/secret rules.

## The parts decided, as decided
- Hub root: `unifyHome/global`. Provider dir: `global/<provider>`.
  Skills: `global/<provider>/skills/<skill>/` (copy, not symlink).
  MCP: `global/<provider>/mcp.json` = `{ mcpServers: {...stripped} }`
  plus a sidecar `{ "<server>": { hadSecrets: true } }` in the same
  file under `_unify`? No — to keep hub files valid MCP JSON, the
  hadSecrets flag lives in a separate `global/<provider>/mcp-meta.json`.
  (Builder's call: keep MCP JSON clean; meta in its own file.)
- Collect skills: list each target's real skills folder (discovery),
  copy each skill folder into the hub, excluding nothing except
  dot-directories. A skill already in the hub is overwritten by
  the provider's current copy on collect (hub is a mirror, so the
  provider wins on collect).
- Collect MCP: for each JSON MCP config that exists, read
  `mcpServers`, strip secrets with the Phase 2 logic, write the
  hub MCP file. TOML configs are reported as unsupported, not guessed.
- Distribute skills: for each hub skill, copy it into every other
  provider's real skills folder if absent; if present, report
  skipped (collision), never overwrite.
- Distribute MCP: for each hub MCP server, merge it into every
  other provider's JSON config if absent, using the Phase 2 merge
  (stripped, never overwrite).
- Memory: hub memory is per-profile, not per-provider, because
  agentmemory namespaces are profiles (`work`/`personal`), not
  tools. `global/memory/<profile>.json` holds a snapshot summary
  (`{ profile, namespace, total }`) only in this PR — not individual
  memories, which have no verified export format to mirror safely.
  Individual memory import stays with Phase 2's `import-memory`.

## What's left to the builder
- Exact CLI shape: `unify hub collect`, `unify hub sync`,
  `unify hub watch` (watch blocks until Ctrl+C, like `unify ui`).
- Watcher debounce interval (sensible default, e.g. 300 ms) and
  its test strategy (fixture hub dir, callback, timeout — flaky
  watcher tests must be marked as such or use a short poll).
- Dashboard Sync integration: explicitly out of this PR.
