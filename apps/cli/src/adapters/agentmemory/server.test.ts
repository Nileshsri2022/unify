import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { statSync } from "node:fs"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { composeFailureLines, engineTrace, ensureRunning, fatalEngineLine, findComposeLog, probe, stop, tailOf } from "./server"

/**
 * Lifecycle tests use a FAKE agentmemory CLI: a bash supervisor that starts a
 * tiny node HTTP server answering /agentmemory/livez, plus `stop`. No real
 * agentmemory, no network.
 */

let root: string
let cli: string
let stateDir: string
let port: number
let base: string

const LIVEZ = JSON.stringify({ service: "agentmemory", status: "ok" })

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "unify-am-srv-"))
  stateDir = path.join(root, "state")
  await mkdir(stateDir, { recursive: true })
  port = 39000 + Math.floor(Math.random() * 1000)
  base = `http://127.0.0.1:${port}`

  const fakeServer = `
const http = require("http");
const livez = ${JSON.stringify(LIVEZ)};
const srv = http.createServer((req, res) => {
  if (req.url === "/agentmemory/livez") { res.setHeader("content-type","application/json"); res.end(livez); }
  else res.statusCode = 404, res.end();
});
srv.listen(${port}, "127.0.0.1", () => {
  require("fs").writeFileSync(process.env.FAKE_STATE + "/server.pid", String(process.pid));
});
`
  await writeFile(path.join(root, "server.js"), fakeServer, "utf8")

  const script = `#!/usr/bin/env bash
set -e
if [ "$1" = "stop" ]; then
  pidfile="$FAKE_STATE/server.pid"
  if [ -f "$pidfile" ]; then kill "$(cat "$pidfile")" 2>/dev/null || true; rm -f "$pidfile"; fi
  echo "stopped (fake)"
  exit 0
fi
# start mode: supervisor keeps running (like real agentmemory)
FAKE_STATE="$FAKE_STATE" node "$(dirname "$0")/server.js" &
wait
`
  cli = path.join(root, "agentmemory-fake")
  await writeFile(cli, script, { mode: 0o755 })
})

afterAll(async () => {
  // best-effort cleanup of any leaked fake server
  try {
    const { readFile } = await import("node:fs/promises")
    const pid = Number(await readFile(path.join(stateDir, "server.pid"), "utf8"))
    process.kill(pid, "SIGKILL")
  } catch {
    /* already stopped */
  }
  await rm(root, { recursive: true, force: true })
})

describe("agentmemory server lifecycle (fake CLI)", () => {
  test("probe: false when nothing listening", async () => {
    expect(await probe(base)).toBe(false)
  })

  test("ensureRunning: starts server, waits for livez", async () => {
    const r = await ensureRunning({
      cliPath: cli,
      home: root,
      baseUrl: base,
      logFile: path.join(root, "server.log"),
      readyTimeoutMs: 15000,
      env: { FAKE_STATE: stateDir },
    })
    expect(r.started).toBe(true)
    expect(await probe(base)).toBe(true)
  })

  test("ensureRunning: idempotent (already up → not started)", async () => {
    const r = await ensureRunning({
      cliPath: cli,
      home: root,
      baseUrl: base,
      logFile: path.join(root, "server.log"),
      readyTimeoutMs: 15000,
      env: { FAKE_STATE: stateDir },
    })
    expect(r.started).toBe(false)
  })

  test("stop: brings the server down", async () => {
    await stop(cli, root, { FAKE_STATE: stateDir })
    // give the OS a moment to close the socket
    for (let i = 0; i < 10 && (await probe(base)); i++) await new Promise((r) => setTimeout(r, 200))
    expect(await probe(base)).toBe(false)
  })

  test("ensureRunning: times out when CLI never comes up", async () => {
    const noop = path.join(root, "agentmemory-noop")
    await writeFile(noop, "#!/usr/bin/env bash\nsleep 30 &\nwait\n", { mode: 0o755 })
    await expect(
      ensureRunning({
        cliPath: noop,
        home: root,
        baseUrl: base,
        logFile: path.join(root, "noop.log"),
        readyTimeoutMs: 1500,
      }),
    ).rejects.toThrow(/not ready|timed out/i)
  })
})

describe("startup failures are fast and readable", () => {
  test("supervisor that exits immediately → rejects in ~1s with exit code + log tail", async () => {
    const logFile = path.join(root, "dies.log")
    const cli = path.join(root, "agentmemory-dies")
    await writeFile(cli, '#!/usr/bin/env bash\necho "boom: iii-engine missing" >&2\nexit 3\n', {
      mode: 0o755,
    })
    const started = Date.now()
    const err = (await ensureRunning({
      cliPath: cli,
      home: root,
      baseUrl: "http://127.0.0.1:1", // nothing there
      logFile,
      readyTimeoutMs: 30_000,
    }).catch((e: unknown) => e as Error)) as Error
    const elapsed = Date.now() - started
    expect(err).toBeInstanceOf(Error)
    // must not wait out the 30s deadline
    expect(elapsed).toBeLessThan(10_000)
    expect(err.message).toContain("exited before it was ready")
    expect(err.message).toContain("boom: iii-engine missing")
  })

  test("supervisor that stays alive after a fatal engine error → rejects without the full timeout", async () => {
    const logFile = path.join(root, "hangs.log")
    const cli = path.join(root, "agentmemory-hangs")
    await writeFile(
      cli,
      '#!/usr/bin/env bash\necho "■  Could not start iii-engine."\nsleep 60\n',
      { mode: 0o755 },
    )
    const started = Date.now()
    const err = (await ensureRunning({
      cliPath: cli,
      home: root,
      baseUrl: "http://127.0.0.1:1",
      logFile,
      readyTimeoutMs: 45_000,
    }).catch((e: unknown) => e as Error)) as Error
    const elapsed = Date.now() - started
    expect(elapsed).toBeLessThan(15_000)
    expect(err.message).toContain("cannot start")
    expect(err.message).toContain("iii-engine")
    // no stack frames in the user-facing message
    expect(err.message).not.toContain("at ensureRunning")
  })
})

describe("tailOf / fatalEngineLine", () => {
  test("tailOf strips ANSI + box drawing and keeps the actionable tail", async () => {
    const logFile = path.join(root, "noisy.log")
    await writeFile(
      logFile,
      [
        "\u001b[?25l│  agentmemory v0.9.31",
        "╭──────────────────────────╮",
        "│  Setup required          │",
        "├──────────────────────────╯",
        "Install iii-engine v0.25.0 manually",
        "",
        "   ",
      ].join("\n"),
    )
    const tail = tailOf(logFile)
    expect(tail).not.toContain("│")
    expect(tail).not.toContain("╭")
    expect(tail).not.toContain("\u001b")
    expect(tail).toContain("Install iii-engine v0.25.0 manually")
  })

  test("tailOf on a missing log says so", () => {
    expect(tailOf(path.join(root, "nope.log"))).toBe("(no log)")
  })

  test("fatalEngineLine matches real agentmemory failure lines, ignores chatter", async () => {
    const bad = path.join(root, "fatal.log")
    await writeFile(bad, "agentmemory v0.9.31\n■  Could not start iii-engine.\n")
    expect(fatalEngineLine(bad)).toContain("Could not start iii-engine")

    const okay = path.join(root, "okay.log")
    await writeFile(okay, "agentmemory v0.9.31\nworker ready on :3111\n")
    expect(fatalEngineLine(okay)).toBeNull()

    expect(fatalEngineLine(path.join(root, "absent.log"))).toBeNull()
  })
})

/**
 * Regression (reported on Windows): the log is append-only, so a
 * "Could not start iii-engine" box left by an EARLIER run made the next start
 * abort in ~1s before agentmemory had printed anything of its own — the user
 * saw a failure quoting an old log. Only this run's bytes may count.
 */
describe("stale log content must not abort a fresh start", () => {
  test("fatalEngineLine ignores lines written before the offset", async () => {
    const logFile = path.join(root, "stale.log")
    await writeFile(logFile, "■  Could not start iii-engine.\nSetup required\n")
    const offset = statSync(logFile).size
    expect(fatalEngineLine(logFile)).not.toBeNull() // no offset → sees it (legacy)
    expect(fatalEngineLine(logFile, offset)).toBeNull() // this run wrote nothing

    await writeFile(logFile, "worker ready\n", { flag: "a" })
    expect(fatalEngineLine(logFile, offset)).toBeNull()
  })

  test("fatalEngineLine still catches a fatal line written by this run", async () => {
    const logFile = path.join(root, "fresh.log")
    await writeFile(logFile, "old box: Could not start iii-engine.\n")
    const offset = statSync(logFile).size
    await writeFile(logFile, "■  Could not start iii-engine.\n", { flag: "a" })
    expect(fatalEngineLine(logFile, offset)).toContain("Could not start iii-engine")
  })

  test("tailOf with an offset only shows this run, and says so when empty", async () => {
    const logFile = path.join(root, "tail-offset.log")
    await writeFile(logFile, "old failure line\n")
    const offset = statSync(logFile).size
    expect(tailOf(logFile, 8, offset)).toBe("(no output from this run)")
    await writeFile(logFile, "new line A\nnew line B\n", { flag: "a" })
    const tail = tailOf(logFile, 8, offset)
    expect(tail).toContain("new line B")
    expect(tail).not.toContain("old failure line")
  })

  test("a stale fatal box does NOT stop a supervisor that starts fine", async () => {
    const logFile = path.join(root, "stale-ok.log")
    await writeFile(logFile, "■  Could not start iii-engine.\n")
    // same fake supervisor the lifecycle tests use (it binds the shared port)
    const r = await ensureRunning({
      cliPath: cli,
      home: root,
      baseUrl: base,
      logFile,
      readyTimeoutMs: 15000,
      env: { FAKE_STATE: stateDir },
    })
    expect(r.started).toBe(true)
    await stop(cli, root, { FAKE_STATE: stateDir })
  })
})

describe("engineTrace", () => {
  test("picks agentmemory's discovery lines out of a noisy log", async () => {
    const logFile = path.join(root, "trace.log")
    await writeFile(
      logFile,
      [
        "\x1b[32magentmemory\x1b[0m v0.9.31",
        "iii binary: (not on PATH)",
        "fallback iii at C:\\Users\\n\\.agentmemory\\bin\\iii.exe reports version: 0.25.0",
        "some unrelated chatter",
        "iii on PATH is v0.24.0, pin is v0.25.0. Will install pinned engine to …",
        "iii-engine could not be started.", // box text: not a discovery line
        "iii binary: (not on PATH)", // duplicate, must collapse
      ].join("\n"),
    )
    const t = engineTrace(logFile)
    expect(t).toHaveLength(3)
    expect(t[0]).toBe("iii binary: (not on PATH)")
    expect(t[1]).toContain("reports version: 0.25.0")
    expect(t[2]).toContain("pin is v0.25.0")
  })

  test("ignores everything written before this run's offset", async () => {
    const logFile = path.join(root, "trace-offset.log")
    await writeFile(logFile, "iii binary: OLD RUN\n")
    const offset = statSync(logFile).size
    expect(engineTrace(logFile, offset)).toEqual([])
    await writeFile(logFile, "iii binary: (not on PATH)\n", { flag: "a" })
    expect(engineTrace(logFile, offset)).toEqual(["iii binary: (not on PATH)"])
  })
})

/**
 * Windows report: engine accepted, then
 *   "error[PROJECT_DID_NOT_START]: …worker-compose.yaml did not start
 *    Compose exited with code 1"
 * The worker's actual error is only in the Compose daemon log
 * (<dataDir>/compose/compose-daemon.log). unify must read it.
 */
describe("compose support", () => {
  test("composeFailureLines drops box drawing/noise and keeps the tail", async () => {
    const log = path.join(root, "compose-daemon.log")
    await writeFile(
      log,
      [
        "\x1b[2m│ starting project\x1b[0m",
        "  downloading state@0.22.20 …",
        "error: worker state failed to start",
        "  spawn cmd /C … exit code 1",
        "",
        "error[PROJECT_DID_NOT_START]: worker-compose.yaml did not start",
      ].join("\n"),
    )
    const lines = composeFailureLines(log)
    expect(lines).toContain("error: worker state failed to start")
    expect(lines.at(-1)).toContain("PROJECT_DID_NOT_START")
    expect(lines.join("\n")).not.toContain("downloading")
    expect(lines.join("\n")).not.toContain("\x1b[")
  })

  test("missing compose log is empty, not a crash", () => {
    expect(composeFailureLines(path.join(root, "nope.log"))).toEqual([])
  })

  test("a Compose failure carries the daemon log into the error", async () => {
    // stub supervisor: prints agentmemory's compose failure, exits 1
    const dataDir = path.join(root, "xdg", "agentmemory")
    await mkdir(path.join(dataDir, "compose"), { recursive: true })
    await writeFile(
      path.join(dataDir, "compose", "compose-daemon.log"),
      [
        "│ starting",
        "error: container state: failed to start worker",
        "error[PROJECT_DID_NOT_START]: /…/worker-compose.yaml did not start",
      ].join("\n"),
    )
    const stub = path.join(root, "compose-fail-agentmemory")
    await writeFile(
      stub,
      "#!/usr/bin/env bash\necho 'stopping engine...'\necho 'error[PROJECT_DID_NOT_START]:'\necho '  worker-compose.yaml did not start'\necho 'Compose exited with code 1'\nexit 1\n",
      { mode: 0o755 },
    )
    const logFile = path.join(root, "compose-fail.log")
    const err = await ensureRunning({
      cliPath: stub,
      home: root,
      baseUrl: `http://127.0.0.1:${39500 + Math.floor(Math.random() * 400)}`,
      logFile,
      readyTimeoutMs: 10000,
      env: { XDG_DATA_HOME: path.join(root, "xdg") },
    }).catch((e: Error) => e)

    expect(err).toBeInstanceOf(Error)
    const message = (err as Error).message
    expect(message).toContain("compose log (")
    expect(message).toContain("failed to start worker") // the real cause
    expect(message).toContain("PROJECT_DID_NOT_START")
  })
})

/**
 * The daemon log is where agentmemory actually put it: engine-state.json names
 * the file (`~/.agentmemory/compose-<restPort>.log`). An earlier guess at
 * <dataDir>/compose/compose-daemon.log did not exist on the user's Windows box.
 */
describe("findComposeLog", () => {
  test("uses logFile from engine-state.json", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "unify-am-state-"))
    await mkdir(path.join(home, ".agentmemory"), { recursive: true })
    const log = path.join(home, ".agentmemory", "compose-3111.log")
    await writeFile(log, "error: container http: cannot reach the registry\n")
    await writeFile(
      path.join(home, ".agentmemory", "engine-state.json"),
      JSON.stringify({ kind: "compose", restPort: 3111, logFile: log }),
    )
    const found = findComposeLog({ home, baseUrl: "http://127.0.0.1:3111" })
    expect(found?.path).toBe(log)
    expect(found?.from).toBe("state")
    await rm(home, { recursive: true, force: true })
  })

  test("falls back to ~/.agentmemory/compose-<port>.log without a state file", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "unify-am-state2-"))
    await mkdir(path.join(home, ".agentmemory"), { recursive: true })
    const log = path.join(home, ".agentmemory", "compose-3111.log")
    await writeFile(log, "error: container state: exited with code 1\n")
    const found = findComposeLog({ home, baseUrl: "http://127.0.0.1:3111" })
    expect(found?.path).toBe(log)
    expect(found?.from).toBe("convention")
    await rm(home, { recursive: true, force: true })
  })

  test("null when there is nothing to read (no crash, no invented path)", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "unify-am-state3-"))
    expect(findComposeLog({ home, baseUrl: "http://127.0.0.1:3111" })).toBeNull()
    await rm(home, { recursive: true, force: true })
  })

  test("ignores an empty log and moves on to the next candidate", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "unify-am-state4-"))
    await mkdir(path.join(home, ".agentmemory"), { recursive: true })
    await writeFile(path.join(home, ".agentmemory", "compose-3111.log"), "")
    const xdg = path.join(home, "xdg")
    await mkdir(path.join(xdg, "agentmemory", "compose"), { recursive: true })
    const fallback = path.join(xdg, "agentmemory", "compose", "compose-daemon.log")
    await writeFile(fallback, "error: worker failed\n")
    const found = findComposeLog({
      home,
      baseUrl: "http://127.0.0.1:3111",
      env: { XDG_DATA_HOME: xdg },
    })
    expect(found?.path).toBe(fallback)
    await rm(home, { recursive: true, force: true })
  })
})
