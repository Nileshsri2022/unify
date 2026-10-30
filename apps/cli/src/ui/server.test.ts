import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createApiHandler } from "./server"

/**
 * API contract tests: in-process Bun.serve over createApiHandler, against a
 * stub env (skillshare PATH stub + stub agentmemory REST with agentId scope).
 * Same environment pattern as glue-e2e — verifies the API without a port.
 */

let root: string
let userHome: string
let unifyHome: string
let stubDir: string
let stateDir: string
let port: number
let base: string
let server: ReturnType<typeof Bun.serve>

async function api(method: string, p: string, body?: object): Promise<{ status: number; json: any }> {
  const res = await fetch(base + p, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: res.status, json: await res.json().catch(() => null) }
}

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "unify-api-"))
  userHome = path.join(root, "home")
  unifyHome = path.join(root, "unify")
  stubDir = path.join(root, "bin")
  stateDir = path.join(root, "stub-state")
  port = 37000 + Math.floor(Math.random() * 2000)
  base = `http://127.0.0.1:${port}`

  await mkdir(userHome, { recursive: true })
  await mkdir(unifyHome, { recursive: true })
  await mkdir(stubDir, { recursive: true })
  await mkdir(stateDir, { recursive: true })

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
      "  personal:",
      "    backends:",
      "      skillshare: { enabled: true, targets: [claude] }",
      "      agentmemory: { enabled: true, namespace: personal }",
      "glue:",
      "  post-sync: [inject-agents-md-into-memory]",
      "",
    ].join("\n"),
  )
  await writeFile(path.join(unifyHome, "AGENTS.md"), "# Rules\n- api test\n", "utf8")

  // skillshare stub on PATH (fixtures-backed)
  const fixtures = new URL("../../testdata/skillshare/0.28.0", import.meta.url).pathname
  const skillshareStub = `#!/usr/bin/env bash
case "$*" in
  "--version") cat "${fixtures}/version.out" ;;
  "target list") cat "${fixtures}/target-list.out" ;;
  "sync --json") cat "${fixtures}/sync-apply.json" ;;
  "sync --dry-run --json") cat "${fixtures}/sync-dryrun.json" ;;
  *) echo "stub: unhandled: $*" >&2; exit 1 ;;
esac
`
  await writeFile(path.join(stubDir, "skillshare"), skillshareStub, { mode: 0o755 })

  // stub agentmemory: supervisor + in-memory REST (agentId-aware)
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
      return send(200, { results: hits.map((m) => ({ obsId: m.id, score: 1, title: m.content, type: "fact" })) });
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

  // fake dist for static-serving tests
  const dist = path.join(root, "dist")
  await mkdir(path.join(dist, "assets"), { recursive: true })
  await writeFile(path.join(dist, "index.html"), "<!doctype html><title>unify dashboard</title>", "utf8")
  await writeFile(path.join(dist, "assets", "app.js"), "console.log('app')", "utf8")
  await writeFile(path.join(dist, "style.css"), "body{}", "utf8")

  // API handler under test — real registry/adapters, stub backends behind them
  const handler = createApiHandler({
    userHome,
    unifyHome,
    distDir: path.join(root, "dist"),
    agentmemoryBaseUrl: `http://127.0.0.1:${port}`,
    skillshareBinPath: path.join(stubDir, "skillshare"),
    serverEnv: { STUB_PORT: String(port), STUB_STATE: stateDir },
  })
  server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: handler })
  base = `http://127.0.0.1:${server.port}`
})

afterAll(async () => {
  server.stop(true)
  try {
    const pid = Number(await readFile(path.join(stateDir, "server.pid"), "utf8"))
    process.kill(pid, "SIGKILL")
  } catch {
    /* not started */
  }
  await rm(root, { recursive: true, force: true })
})

describe("GET /api/status", () => {
  test("returns UnifiedStatus + lastSync + memoryLine", async () => {
    const r = await api("GET", "/api/status")
    expect(r.status).toBe(200)
    expect(r.json.status.profile).toBe("work")
    expect(r.json.status.backends.map((b: any) => b.id)).toEqual(["skillshare", "agentmemory"])
    expect(r.json.status.backends[0]).toMatchObject({ id: "skillshare", installed: true, version: "0.28.0" })
    expect(typeof r.json.status.memory.total).toBe("number")
    expect(Array.isArray(r.json.status.targets)).toBe(true)
    expect(typeof r.json.memoryLine).toBe("string")
  })
})

describe("GET /api/doctor", () => {
  test("returns issue list (empty or array)", async () => {
    const r = await api("GET", "/api/doctor")
    expect(r.status).toBe(200)
    expect(Array.isArray(r.json.issues)).toBe(true)
  })
})

describe("profiles API", () => {
  test("GET lists profiles + active", async () => {
    const r = await api("GET", "/api/profiles")
    expect(r.status).toBe(200)
    expect(r.json.active).toBe("work")
    expect(r.json.profiles.map((p: any) => p.name).sort()).toEqual(["personal", "work"])
  })

  test("POST switches profile (yaml rewritten)", async () => {
    const r = await api("POST", "/api/profiles", { name: "personal" })
    expect(r.status).toBe(200)
    expect(r.json.active).toBe("personal")
    const yaml = await readFile(path.join(unifyHome, "unify.yaml"), "utf8")
    expect(yaml).toContain("profile: personal")
  })

  test("POST unknown profile → 404 with available list", async () => {
    const r = await api("POST", "/api/profiles", { name: "nope" })
    expect(r.status).toBe(404)
    expect(r.json.error).toContain("nope")
    expect(r.json.error).toContain("work")
    // restore
    await api("POST", "/api/profiles", { name: "work" })
  })
})

describe("memory API", () => {
  test("POST saves to active profile; GET recalls it (scoped)", async () => {
    const s = await api("POST", "/api/memory", { text: "api memory probe 777", concepts: ["api"] })
    expect(s.status).toBe(200)
    expect(s.json.id).toMatch(/^mem_stub_/)
    expect(s.json.profile).toBe("work")

    const r = await api("GET", "/api/memory?q=api memory probe")
    expect(r.status).toBe(200)
    expect(r.json.profile).toBe("work")
    expect(r.json.namespace).toBe("work")
    expect(r.json.results.some((x: any) => x.title.includes("api memory probe 777"))).toBe(true)

    // personal tab must not see the work memory
    const p = await api("GET", "/api/memory?q=api memory probe&profile=personal")
    expect(p.json.results).toHaveLength(0)
  })

  test("GET without q → 400", async () => {
    const r = await api("GET", "/api/memory")
    expect(r.status).toBe(400)
  })
})

describe("POST /api/sync", () => {
  test("dry-run returns SyncResult without applying glue", async () => {
    const r = await api("POST", "/api/sync", { dryRun: true })
    expect(r.status).toBe(200)
    expect(r.json.result.dryRun).toBe(true)
    expect(Array.isArray(r.json.result.changes)).toBe(true)
    expect(r.json.result.changes.length).toBeGreaterThan(0)
  })

  test("apply sync runs glue (AGENTS.md snapshot injected)", async () => {
    const r = await api("POST", "/api/sync", { dryRun: false })
    expect(r.status).toBe(200)
    expect(r.json.result.dryRun).toBe(false)
    expect(r.json.glue.join("\n")).toContain("AGENTS.md snapshot")
  })
})

describe("error handling", () => {
  test("unknown /api route → 404 JSON", async () => {
    const r = await api("GET", "/api/nope")
    expect(r.status).toBe(404)
    expect(r.json.error).toBeTruthy()
  })

  test("POST to unknown /api route → 404", async () => {
    const r = await api("POST", "/api/nope", {})
    expect(r.status).toBe(404)
  })
})

describe("static dashboard serving", () => {
  test("GET / → index.html (text/html)", async () => {
    const res = await fetch(base + "/")
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("text/html")
    expect(await res.text()).toContain("unify dashboard")
  })

  test("GET asset → correct mime + content", async () => {
    const res = await fetch(base + "/assets/app.js")
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("javascript")
    expect(await res.text()).toContain("console.log")
  })

  test("SPA fallback: unknown non-asset path → index.html", async () => {
    const res = await fetch(base + "/some/deep/route")
    expect(res.status).toBe(200)
    expect(await res.text()).toContain("unify dashboard")
  })

  test("missing asset → 404 JSON", async () => {
    const res = await fetch(base + "/assets/missing.js")
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBeTruthy()
  })
})
