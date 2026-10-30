import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

/**
 * e2e: `unify memory save/recall` against a STUB agentmemory CLI.
 * The stub is a bash supervisor that starts an in-memory node REST server
 * (livez/health/status/remember/smart-search with substring recall) and
 * writes ~/.agentmemory/secret on boot — same lifecycle as the real server.
 */

let root: string
let home: string
let unifyHome: string
let port: number
let base: string
let stateDir: string
let cliEntry: string

async function run(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const p = Bun.spawn(["bun", cliEntry, ...args], {
    cwd: home,
    env: {
      ...process.env,
      HOME: home,
      UNIFY_HOME: unifyHome,
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
  root = await mkdtemp(path.join(os.tmpdir(), "unify-mem-e2e-"))
  home = path.join(root, "home")
  unifyHome = path.join(root, "unify")
  stateDir = path.join(root, "stub-state")
  port = 34000 + Math.floor(Math.random() * 2000)
  base = `http://127.0.0.1:${port}`
  cliEntry = new URL("../index.ts", import.meta.url).pathname
  await mkdir(home, { recursive: true })
  await mkdir(unifyHome, { recursive: true })
  await mkdir(stateDir, { recursive: true })

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
      store.push({ id, content: d.content, concepts: d.concepts || [] });
      return send(200, { memory: { id, content: d.content }, success: true });
    }
    if (url.pathname === "/agentmemory/smart-search") {
      const d = JSON.parse(body);
      const q = (d.query || "").toLowerCase();
      const hits = store.filter((m) => m.content.toLowerCase().includes(q)).slice(0, d.limit || 10);
      return send(200, { results: hits.map((m) => ({ obsId: m.id, score: 1, title: m.content, type: "fact" })) });
    }
    send(404, { error: "not found" });
  });
});
srv.listen(port, "127.0.0.1");
`
  await writeFile(path.join(root, "mock-server.js"), mockServer, "utf8")

  const stub = `#!/usr/bin/env bash
case "$1" in
  stop)
    pidfile="$STUB_STATE/server.pid"
    if [ -f "$pidfile" ]; then kill "$(cat "$pidfile")" 2>/dev/null || true; rm -f "$pidfile"; fi
    echo "stopped (stub)"
    ;;
  init)
    mkdir -p "$HOME/.agentmemory"
    touch "$HOME/.agentmemory/.env"
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
  // stub lives where the mock server expects it relative to (keep path simple: copy server next to stub)
  await writeFile(path.join(unifyHome, "backends", "agentmemory", "node_modules", "mock-server.js"), mockServer, "utf8")
  await writeFile(path.join(binDir, "agentmemory"), stub, { mode: 0o755 })
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

describe("e2e: unify memory save/recall (stub agentmemory)", () => {
  test("save auto-starts the server and returns an id", async () => {
    const r = await run(["memory", "save", "roundtrip e2e probe xyz123", "--concepts", "e2e,probe"])
    expect(r.code).toBe(0)
    expect(r.stdout).toContain("ensuring memory server is running")
    expect(r.stdout).toMatch(/saved mem_stub_\d+/)
  })

  test("recall finds the saved memory (round-trip)", async () => {
    const r = await run(["memory", "recall", "roundtrip e2e probe"])
    expect(r.code).toBe(0)
    expect(r.stdout).toContain("roundtrip e2e probe xyz123")
    expect(r.stdout).toMatch(/mem_stub_1/)
  })

  test("recall with no match", async () => {
    const r = await run(["memory", "recall", "zzz-no-such-memory-zzz"])
    expect(r.code).toBe(0)
    expect(r.stdout).toContain("no memories matched")
  })
})
