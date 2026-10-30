import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

/**
 * e2e: post-sync glue `inject-agents-md-into-memory`.
 * Combined stub env: skillshare stub on PATH (fixtures-backed) + stub
 * agentmemory (bash supervisor + in-memory REST with agentId scoping).
 */

let root: string
let fakeHome: string
let unifyHome: string
let stubDir: string
let callLog: string
let cliEntry: string
let fixturesDir: string
let port: number
let base: string
let stateDir: string
let agentsMd: string

async function run(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const p = Bun.spawn(["bun", cliEntry, ...args], {
    cwd: fakeHome,
    env: {
      ...process.env,
      HOME: fakeHome,
      UNIFY_HOME: unifyHome,
      PATH: `${stubDir}:${process.env.PATH ?? ""}`,
      SH_FIXTURES: fixturesDir,
      SH_CALL_LOG: callLog,
      AGENTMEMORY_URL: base,
      STUB_PORT: String(port),
      STUB_STATE: stateDir,
    },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  const code = await p.exited
  return { code, stdout: await new Response(p.stdout).text(), stderr: await new Response(p.stderr).text() }
}

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "unify-glue-e2e-"))
  fakeHome = path.join(root, "home")
  unifyHome = path.join(root, "unify")
  stubDir = path.join(root, "bin")
  callLog = path.join(root, "calls.log")
  stateDir = path.join(root, "stub-state")
  port = 36000 + Math.floor(Math.random() * 2000)
  base = `http://127.0.0.1:${port}`
  cliEntry = new URL("../index.ts", import.meta.url).pathname
  fixturesDir = new URL("../../testdata/skillshare/0.28.0", import.meta.url).pathname
  agentsMd = path.join(unifyHome, "AGENTS.md")

  await mkdir(fakeHome, { recursive: true })
  await mkdir(unifyHome, { recursive: true })
  await mkdir(stubDir, { recursive: true })
  await mkdir(stateDir, { recursive: true })

  // unify.yaml: work profile, claude target, glue enabled
  await writeFile(
    path.join(unifyHome, "unify.yaml"),
    [
      "version: 1",
      "profile: work",
      "profiles:",
      "  work:",
      "    backends:",
      "      skillshare: { enabled: true, targets: [claude] }",
      "      agentmemory: { enabled: true, namespace: work }",
      "glue:",
      "  post-sync: [inject-agents-md-into-memory]",
      "",
    ].join("\n"),
  )

  // canonical AGENTS.md
  await writeFile(agentsMd, "# Rules\n- Always run tests before commit\n", "utf8")

  // skillshare stub on PATH
  const skillshareStub = `#!/usr/bin/env bash
echo "$*" >> "$SH_CALL_LOG"
case "$*" in
  "--version") cat "$SH_FIXTURES/version.out" ;;
  "sync --json") cat "$SH_FIXTURES/sync-apply.json" ;;
  "sync --dry-run --json") cat "$SH_FIXTURES/sync-dryrun.json" ;;
  *) echo "stub: unhandled: $*" >&2; exit 1 ;;
esac
`
  await writeFile(path.join(stubDir, "skillshare"), skillshareStub, { mode: 0o755 })

  // agentmemory stub: supervisor + in-memory REST (agentId-aware)
  const mockServer = `
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const port = Number(process.env.STUB_PORT);
const store = [];
let n = 0;
const secretPath = path.join(os.homedir(), ".agentmemory", "secret");
fs.mkdirSync(path.dirname(secretPath), { recursive: true });
if (!fs.existsSync(secretPath)) fs.writeFileSync(secretPath, "stub-secret-123");
const secret = fs.readFileSync(secretPath, "utf8").trim();
fs.writeFileSync(process.env.STUB_STATE + "/server.pid", String(process.pid));
const srv = http.createServer((req, res) => {
  const send = (code, obj) => { res.statusCode = code; res.setHeader("content-type", "application/json"); res.end(JSON.stringify(obj)); };
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/agentmemory/livez") return send(200, { service: "agentmemory", status: "ok", viewerPort: 0 });
  if (req.headers["authorization"] !== "Bearer " + secret) return send(401, { error: "unauthorized" });
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    if (url.pathname === "/agentmemory/health") return send(200, { status: "healthy", version: "0.9.31" });
    if (url.pathname === "/agentmemory/status") return send(200, { index: { memoriesIndexed: store.length } });
    if (url.pathname === "/agentmemory/remember") {
      const d = JSON.parse(body);
      const id = "mem_stub_" + ++n;
      store.push({ id, content: d.content, agentId: d.agentId || null });
      return send(200, { memory: { id, content: d.content, agentId: d.agentId || null }, success: true });
    }
    if (url.pathname === "/agentmemory/smart-search") {
      const d = JSON.parse(body);
      const q = (d.query || "").toLowerCase();
      const scoped = d.agentId ? store.filter((m) => m.agentId === d.agentId) : store;
      const hits = scoped.filter((m) => m.content.toLowerCase().includes(q)).slice(0, d.limit || 10);
      return send(200, { results: hits.map((m) => ({ obsId: m.id, score: 1, title: m.content.slice(0, 80), type: "fact" })) });
    }
    send(404, { error: "not found" });
  });
});
srv.listen(port, "127.0.0.1");
`
  const agentmemoryStub = `#!/usr/bin/env bash
case "$1" in
  stop)
    pidfile="$STUB_STATE/server.pid"
    if [ -f "$pidfile" ]; then kill "$(cat "$pidfile")" 2>/dev/null || true; rm -f "$pidfile"; fi
    echo "stopped (stub)"
    ;;
  *)
    node "$(dirname "$0")/../mock-server.js" &
    wait
    ;;
esac
`
  const binDir = path.join(unifyHome, "backends", "agentmemory", "node_modules", ".bin")
  const pkgDir = path.join(unifyHome, "backends", "agentmemory", "node_modules", "@agentmemory", "agentmemory")
  await mkdir(binDir, { recursive: true })
  await mkdir(pkgDir, { recursive: true })
  await writeFile(path.join(pkgDir, "package.json"), JSON.stringify({ name: "@agentmemory/agentmemory", version: "0.9.31" }), "utf8")
  await writeFile(path.join(unifyHome, "backends", "agentmemory", "node_modules", "mock-server.js"), mockServer, "utf8")
  await writeFile(path.join(binDir, "agentmemory"), agentmemoryStub, { mode: 0o755 })
})

afterAll(async () => {
  try {
    const pid = Number(await readFile(path.join(stateDir, "server.pid"), "utf8"))
    process.kill(pid, "SIGKILL")
  } catch {
    /* not started */
  }
  await rm(root, { recursive: true, force: true })
})

describe("e2e: post-sync glue (stub skillshare + stub agentmemory)", () => {
  test("first sync: applies sync AND injects the AGENTS.md snapshot", async () => {
    const r = await run(["sync"])
    expect(r.code).toBe(0)
    expect(r.stdout).toContain("skillshare sync")
    expect(r.stdout).toContain("glue: AGENTS.md snapshot → memory (profile: work, hash")
    expect(r.stdout).toMatch(/hash [0-9a-f]{12}\)/)
  })

  test("second sync: snapshot up to date, no duplicate injection", async () => {
    const r = await run(["sync"])
    expect(r.code).toBe(0)
    expect(r.stdout).toContain("glue: AGENTS.md snapshot up to date (hash")
    expect(r.stdout).not.toContain("snapshot → memory")
  })

  test("edited AGENTS.md: sync re-injects with a new hash", async () => {
    const r1 = await run(["sync"])
    const oldHash = (r1.stdout.match(/hash ([0-9a-f]{12})/) ?? [])[1]
    await writeFile(agentsMd, "# Rules\n- Always run tests before commit\n- New: ask before deleting\n", "utf8")
    const r2 = await run(["sync"])
    expect(r2.code).toBe(0)
    expect(r2.stdout).toContain("glue: AGENTS.md snapshot → memory (profile: work, hash")
    const newHash = (r2.stdout.match(/hash ([0-9a-f]{12})/) ?? [])[1]
    expect(newHash).toBeTruthy()
    expect(newHash).not.toBe(oldHash)
  })

  test("missing AGENTS.md: glue skips, sync still succeeds (exit 0)", async () => {
    await rm(agentsMd, { force: true })
    const r = await run(["sync"])
    expect(r.code).toBe(0)
    expect(r.stdout).toContain("skillshare sync")
    expect(r.stdout).toContain("glue: skipped — AGENTS.md not found")
  })

  test("dry-run sync: no glue output, nothing written", async () => {
    await writeFile(agentsMd, "# Rules\n- dry\n", "utf8")
    const r = await run(["sync", "--dry-run"])
    expect(r.code).toBe(0)
    expect(r.stdout).not.toContain("glue:")
  })
})
