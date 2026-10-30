# Initial setup — clean machine → working dashboard

Verified on Linux x86_64 with Bun 1.4.4 / Node 22; macOS works the same.
Windows is supported for install/launch since M6 (zip asset with `skillshare.exe`,
agentmemory started through `node`) — see [Windows notes](#windows-notes).

Every command below is copy-pasteable from the repo root unless noted.

---

## 0. Prerequisites

| Need | Why | Check |
| --- | --- | --- |
| **Bun** ≥ 1.1 | CLI runtime + bundler + test runner | `bun --version` |
| **Node** ≥ 20 | agentmemory supervisor + its CLI | `node --version` |
| **git** | clone | `git --version` |
| `curl`, `tar` | pinned skillshare download + extract (`unzip` on Windows) | `curl --version`, `tar --version` |

Install Bun if it is missing:

```bash
curl -fsSL https://bun.sh/install | bash
export PATH="$HOME/.bun/bin:$PATH"     # or restart the shell
bun --version
```

Node 20+ if it is missing (agentmemory refuses older ones):

```bash
node --version                         # v20.x or newer
```

---

## 1. Clone and install dependencies

```bash
git clone https://github.com/Nileshsri2022/unify.git
cd unify
bun install
```

`bun install` is a workspace install — it covers `packages/core`,
`apps/cli` and `apps/dashboard` in one shot.

---

## 2. Build the CLI and the dashboard

```bash
bun run build:cli        # → apps/cli/dist/unify   (single static binary)
bun run build:dashboard  # → apps/dashboard/dist   (static files served by `unify ui`)

./apps/cli/dist/unify version   # unify v0.2.0
```

`unify ui` builds the dashboard on first run if `apps/dashboard/dist` is
missing, so the second command is optional — it just makes the first
`unify ui` instant instead of a ~2 s build.

---

## 3. One-time machine setup

```bash
./apps/cli/dist/unify init
```

Add `--yes` to skip the "Apply sync now? [y/N]" prompt (CI, scripts).
Add `--skip-install` to not download backends (offline machines).

What it does, in order:

1. detects installed AI tools (`claude`, `cursor`, `codex`, `gemini`, …)
2. writes `~/.unify/unify.yaml` (profiles `work` + `personal`) — never clobbers an existing file
3. writes the canonical `~/.unify/AGENTS.md` (edit this; it gets snapshotted into memory)
4. installs pinned **skillshare v0.28.0**, SHA256-verified, into `~/.unify/backends/skillshare/`
5. installs pinned **agentmemory 0.9.31** via npm into `~/.unify/backends/agentmemory/` and starts its memory server
6. dry-runs the skill sync, then applies it (prompted unless `--yes`)

A failed download (proxy, firewall, TLS interception) prints the exact asset URL,
its SHA256 and where to extract it — it never dumps a stack trace.

---

## 4. Verify

```bash
./apps/cli/dist/unify status     # backends + per-target sync matrix
./apps/cli/dist/unify doctor     # cross-backend issues (empty = healthy)
```

Healthy output looks like this (versions are the pinned ones):

```
unify — status (profile: work)

BACKEND      VERSION   PINNED    HEALTH
skillshare   0.28.0    0.28.0    ok
agentmemory  0.9.31    0.9.31    ok

TARGET       STATE          DETAIL
claude       in-sync        2 skill(s) linked

Memory: 1 entries (agentmemory v0.9.31, profile: work)
Last sync: 2026-10-30T13:07:06.839Z
```

`unify doctor` prints `doctor: all checks passed` when there is nothing to fix.

`installed: false` / `not-installed` is a *valid* state, not a crash — it means
that backend has not been installed yet (`unify init`).

---

## 5. Open the dashboard

```bash
./apps/cli/dist/unify ui
```

→ **http://127.0.0.1:7420** — dashboard and JSON API on one port.

| Flag / env | Default | Use |
| --- | --- | --- |
| `--port n` / `$UNIFY_UI_PORT` | `7420` | port already taken |
| `--host h` / `$UNIFY_UI_HOST` | `127.0.0.1` | containers, remote sandboxes (`0.0.0.0`); **no auth** |
| `--api-only` | off | JSON API only — pair with `bun run dev:dashboard` |
| `$UNIFY_UI_DIST` | `apps/dashboard/dist` | serve a dashboard built elsewhere |

Stop with `Ctrl-C` (exits 0, closes the port).

Optional — put `unify` on `PATH` so the paths above become plain `unify …`:

```bash
sudo ln -sf "$PWD/apps/cli/dist/unify" /usr/local/bin/unify
unify version
```

---

## Daily commands

```bash
unify status [--json]                 # backend health + sync matrix
unify doctor                          # what is broken and how to fix it
unify sync [--dry-run] [--target t]   # push skills to targets (+ memory glue)
unify memory save "<text>" [--concepts a,b]
unify memory recall "<query>" [--limit n]
unify profile [work|personal]         # show / switch active profile
unify ui                              # dashboard + API
```

---

## Dev workflow (hot reload)

Two processes: API only + vite dev with `/api` proxied to it.

```bash
./apps/cli/dist/unify ui --api-only     # terminal 1 → JSON API on :7420
bun run dev:dashboard                   # terminal 2 → vite on :5173
```

Then open http://localhost:5173. Without the API running the dashboard shows the
amber **Demo mode** banner and mock data.

## Checks before a PR

```bash
bun run test        # unit tests: core + cli + dashboard lib
bun run typecheck   # dashboard, core, cli — tsc, strict
bun run build:cli && bun run build:dashboard
```

---

## Windows notes

```powershell
irm bun.sh/install.ps1 | iex
git clone https://github.com/Nileshsri2022/unify.git
cd unify
bun install
bun run build:cli
bun run build:dashboard
.\apps\cli\dist\unify.exe init
.\apps\cli\dist\unify.exe ui
```

- The pinned skillshare release for Windows is a **.zip containing `skillshare.exe`**;
  it is extracted in-process (no `unzip` needed) to
  `%USERPROFILE%\.unify\backends\skillshare\skillshare.exe`, and detection looks
  for the `.exe` name.
- agentmemory is started as `node <pkg>\dist\cli.mjs` — npm's `.bin\agentmemory`
  shim is a shell script Windows cannot execute.
- **unify installs agentmemory's `iii-engine` itself.** agentmemory 0.9.31 cannot
  install it on Windows (it needs `sh`/`curl`/`tar` and refuses `.zip` assets), so
  unify downloads the pinned `iii v0.25.0` asset, verifies its SHA-256, extracts
  `iii.exe` in-process and places it at `%USERPROFILE%\.agentmemory\bin\iii.exe`
  — the path agentmemory reads first. Set `UNIFY_SKIP_ENGINE_INSTALL=1` to manage
  the engine yourself.
- State lives in `C:\Users\<you>\.unify`; the dashboard is at
  `http://127.0.0.1:7420`.
- Running inside WSL is the same as Linux — use the Linux commands above.

---

## Troubleshooting

| Symptom | What it means | Fix |
| --- | --- | --- |
| Amber **“Demo mode — the unify API is offline”** | No HTTP response from `/api/*` — `unify ui` is not running (or a different port) | `unify ui` — the banner retries every 30 s, no reload needed. On vite dev: `unify ui --api-only` so `/api` has something to proxy to |
| Red **“API error 500 …”** banner | The API is up and a handler failed | read the message, run `unify doctor`; the banner retries automatically |
| `skillshare not installed` | Backend not installed (normal before `unify init`) | `unify init` (or `--skip-install` after installing the binary yourself) |
| `memory server not running` | agentmemory installed, supervisor down | `unify init`, else read `~/.unify/state/agentmemory-server.log` (often iii-engine download / Node < 20) |
| `unify memory: iii-engine is required by agentmemory but could not be installed: …` | the pinned engine could not be downloaded/verified on this machine | check GitHub release access, then `unify init` again; manual steps in the message. `UNIFY_SKIP_ENGINE_INSTALL=1` if you install `iii` yourself |
| `… agentmemory cannot start: iii-engine could not be started` **while `iii.exe` exists** | agentmemory 0.9.31 checks the engine itself: `iii --version` with **stdout only and a hard 3 s timeout**; if that fails it treats the engine as missing and falls into an installer that cannot run on Windows | rebuild `unify` (M6.3): it runs agentmemory's exact check first, prints `agentmemory's engine check:` with the reason (timeout / stderr-only / exit code), and turns on agentmemory's own `--verbose` discovery log |
| **`PROJECT_DID_NOT_START` / `The network path was not found.`** (agentmemory 0.9.31) | 0.9.31 starts its worker as a Compose *script* container; iii-compose runs it via `cmd /C` with Rust-escaped quotes, which cmd cannot parse, so the container dies instantly | unify pins **agentmemory 0.9.30** + iii **0.22.1**, which predate Compose (the engine spawns the worker directly, no shell). `unify init` replaces a 0.9.31 install automatically |
| `error[PROJECT_DID_NOT_START] … worker-compose.yaml did not start` / `Compose exited with code 1` | agentmemory's engine is running, but its Compose project failed: the `state`/`http` worker packages come from **`api.workers.iii.dev`**, so a proxy/VPN/firewall that blocks it (or a corporate DNS) stops the project | unify now prints `compose log (…/agentmemory/compose/compose-daemon.log)` with the container's own error. Allow `api.workers.iii.dev`, or read the full log: `Get-Content "$env:APPDATA\agentmemory\compose\compose-daemon.log" -Tail 60` |
| `unify init` stops at "ensuring memory server …" but finishes quickly | by design since M6.1: memory failures are non-fatal and reported in ≤2 s | skills still sync; fix the cause above and run `unify memory save "ping"` |
| `unify ui: config invalid:` | `~/.unify/unify.yaml` failed the zod schema — `unify ui` refuses to start rather than serve half-broken state | fix the file, or `mv ~/.unify/unify.yaml{,.bak}` and re-run `unify init` |
| `EADDRINUSE` / port busy | 7420 taken | `unify ui --port 7421` or `UNIFY_UI_PORT=7421 unify ui` |
| Dashboard unreachable from a container | loopback bind | `unify ui --host 0.0.0.0` (no auth — expose deliberately) |
| `bun: command not found` | Bun not on `PATH` | `export PATH="$HOME/.bun/bin:$PATH"` (Windows: `irm bun.sh/install.ps1 \| iex`) |
| `skillshare init failed: ✗ skillshare is already initialized` | older builds: skillshare's global config lives in `%APPDATA%\skillshare\config.yaml` on Windows, so unify's XDG check missed it and re-ran `init` | fixed — "already initialized" is treated as success; on old builds run `unify sync` directly |
| `unify init: skillshare still not detected after installing` | the binary was written somewhere detection does not look | the message prints the expected path — check it exists, or set `SKILLSHARE_BIN` |
| `skillshare binary not found — install it or run unify init without --skip-install` | older build where the Windows `.exe` was not detected | rebuild (`bun run build:cli`) and re-run `unify init` |
| `unify ui: dashboard build not found` | binary copied outside the repo and no dist | `UNIFY_UI_DIST=/path/to/apps/dashboard/dist unify ui`, or run from a checkout |

---

## Where state lives

| Path | Contents |
| --- | --- |
| `~/.unify/unify.yaml` | profiles, backends, glue — the only config file |
| `~/.unify/AGENTS.md` | canonical agent instructions (snapshotted into memory after sync) |
| `~/.unify/backends/` | pinned skillshare binary + npm-installed agentmemory |
| `~/.unify/cache/` | downloaded release archives |
| `~/.unify/state/` | `last-sync.json`, `lock.json`, memory-server log |
| `~/.config/skillshare/skills/` | skill sources (skillshare's dir, not unify's) |

Environment overrides: `UNIFY_HOME`, `UNIFY_UI_PORT`, `UNIFY_UI_HOST`,
`UNIFY_UI_DIST`, `SKILLSHARE_BIN`, `AGENTMEMORY_URL`.

---

## One-liner (impatient path)

```bash
git clone https://github.com/Nileshsri2022/unify.git && cd unify \
  && bun install && bun run build:cli && bun run build:dashboard \
  && ./apps/cli/dist/unify init --yes \
  && ./apps/cli/dist/unify status \
  && ./apps/cli/dist/unify ui
```
