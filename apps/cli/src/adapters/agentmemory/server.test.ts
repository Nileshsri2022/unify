import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { ensureRunning, probe, stop } from "./server"

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
