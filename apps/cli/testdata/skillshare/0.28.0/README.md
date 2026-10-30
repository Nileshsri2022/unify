# skillshare v0.28.0 — pinned output contract

These fixtures are the **contract** between unify and skillshare. All adapter
tests run against these files only — **no network, no real binary in CI**.

## Pin

- Version: `0.28.0`
- Release: https://github.com/runkids/skillshare/releases/tag/v0.28.0
- linux_amd64 tarball sha256: `c4f3f60d30130014b82e3c383aa64c8c26996920202b1c98db075a5a346c4f96`
- Extracted binary sha256: `42666c53cb9ef36858e90fb7d649f0f786f49f83bb067d50a7bdd920a36f0cc5`
- All platform hashes: see `apps/cli/src/adapters/skillshare/manifest.ts` (from release `checksums.txt`)

## How fixtures were recorded

Recorded on 2026-10-29/30 on linux/amd64, in an isolated `$HOME` with fake
`~/.claude`, `~/.gemini`, `~/.agents` dirs and a source skill
(`~/.config/skillshare/skills/code-review`).

| File | Command |
|---|---|
| `version.out` | `skillshare --version` |
| `target-list.out` | `skillshare target list` (after `init --no-copy --all-targets`; 3 targets: claude, gemini, universal) |
| `target-list-after.out` | `skillshare target list` (after `target add cursor ~/.cursor/skills`; 4 targets) |
| `list.json` | `skillshare list --json` |
| `sync-dryrun.json` | `skillshare sync --dry-run --json` |
| `sync-apply.json` | `skillshare sync --json` |
| `sync-dryrun-insync.json` | `skillshare sync --dry-run --json` after a clean apply |

## Why this matters

`skillshare sync --dry-run --json` reports **desired state, not a diff**
(empirically verified: `linked` persists after a clean apply; `updated` stays
0 after editing a source skill, because symlink mode auto-syncs content).
Therefore unify computes **drift from the filesystem**: a source skill that is
not linked in a target's skills dir = `drift` (see
`apps/cli/src/adapters/skillshare/index.ts` → `fullStatus`).

If skillshare changes any output format upstream, the parser tests
(`apps/cli/src/adapters/skillshare/parse.test.ts`) fail **loud and on
purpose** — that is the upstream-churn radar. Re-record fixtures against the
new version, bump the pin in `manifest.ts`, and re-baseline the goldens.

## Re-recording recipe

```bash
export HOME=$(mktemp -d)            # isolated home
mkdir -p $HOME/.claude/skills $HOME/.gemini/skills $HOME/.config/skillshare/skills/code-review
./skillshare --version  > version.out
./skillshare init --no-copy --all-targets
./skillshare target list > target-list.out
./skillshare list --json > list.json
./skillshare sync --dry-run --json > sync-dryrun.json
./skillshare sync --json > sync-apply.json
./skillshare sync --dry-run --json > sync-dryrun-insync.json
```
