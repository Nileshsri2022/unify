import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { Runner } from "../runner"
import { AgentmemoryAdapter, agentmemoryCliPath } from "./index"

const SECRET = "adapter-secret"
const PKG = "@agentmemory/agentmemory"

let root: string
let home: string
let unifyHome: string
let server: ReturnType<typeof Bun.serve>
let base: string
let calls: string[]

function fixture(name: string): Promise<string> {
  return readFile(new URL(`../../../testdata/agentmemory/0.9.31/${name}`, import.meta.url), "utf8")
}

async function buildEnv(count: number): Promise<void> {
  // fake installed backend layout
  const binDir = path.join(unifyHome, "backends", "agentmemory", "node_modules", ".bin")
  const pkgDir = path.join(unifyHome, "backends", "agentmemory", "node_modules", PKG)
  await mkdir(binDir, { recursive: true })
  await mkdir(pkgDir, { recursive: true })
  await writeFile(path.join(pkgDir, "package.json"), JSON.stringify({ name: PKG, version: "0.9.31" }), "utf8")
  await writeFile(agentmemoryCliPath(unifyHome), "#!/bin/sh\ntrue\n", { mode: 0o755 })
  // agentmemory home (secret)
  const amHome = path.join(home, ".agentmemory")
  await mkdir(amHome, { recursive: true })
  await writeFile(path.join(amHome, "secret"), SECRET, "utf8")
}

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "unify-am-adapter-"))
  home = path.join(root, "home")
  unifyHome = path.join(root, "unify")
  await mkdir(home, { recursive: true })
  await mkdir(unifyHome, { recursive: true })
  await buildEnv(0)
  calls = []

  const livez = await fixture("livez.json")
  const health = await fixture("health.json")
  const statusDoc = await fixture("status.json")

  server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url)
      const authorized = req.headers.get("authorization") === `Bearer ${SECRET}`
      if (url.pathname === "/agentmemory/livez") return Response.json(JSON.parse(livez))
      if (!authorized) return new Response("unauthorized", { status: 401 })
      if (url.pathname === "/agentmemory/health")
        return Response.json({ ...JSON.parse(health), version: HEALTH_VERSION })
      if (url.pathname === "/agentmemory/status")
        return Response.json({ ...JSON.parse(statusDoc), index: { memoriesIndexed: COUNT } })
      if (url.pathname === "/agentmemory/remember") return new Response("nope", { status: 500 })
      return new Response("not found", { status: 404 })
    },
  })
  base = `http://127.0.0.1:${server.port}`
})

afterAll(async () => {
  server?.stop(true)
  await rm(root, { recursive: true, force: true })
})

let COUNT = 0
const setCount = (n: number) => {
  COUNT = n
}
let HEALTH_VERSION = "0.9.31"
const setHealthVersion = (v: string) => {
  HEALTH_VERSION = v
}

const runner: Runner = async (args) => {
  calls.push(args.join(" "))
  return { code: 0, stdout: "", stderr: "" }
}
const nodeRunner: Runner = async (args) => {
  calls.push(`node ${args.join(" ")}`)
  return { code: 0, stdout: "v20.20.2\n", stderr: "" }
}
const npmRunner: Runner = async (args) => {
  calls.push(`npm ${args.join(" ")}`)
  return { code: 0, stdout: "", stderr: "" }
}

const adapter = () =>
  new AgentmemoryAdapter({ home, unifyHome, baseUrl: base, runner, nodeRunner, npmRunner })

describe("AgentmemoryAdapter (mock server + fake runners)", () => {
  test("detect: installed, version from package.json (server up → health version)", async () => {
    setCount(0)
    const det = await adapter().detect()
    expect(det.installed).toBe(true)
    expect(det.version).toBe("0.9.31")
    expect(det.path).toContain("backends/agentmemory")
  })

  test("detect: not installed when bin missing", async () => {
    const h2 = await mkdtemp(path.join(os.tmpdir(), "unify-am-adapter-none-"))
    try {
      const a = new AgentmemoryAdapter({
        home: h2,
        unifyHome: h2,
        baseUrl: base,
        runner,
        nodeRunner,
        npmRunner,
      })
      expect((await a.detect()).installed).toBe(false)
    } finally {
      await rm(h2, { recursive: true, force: true })
    }
  })

  test("fullStatus: server up → healthy + memory count", async () => {
    setCount(7)
    const fs = await adapter().fullStatus()
    expect(fs.backend.installed).toBe(true)
    expect(fs.backend.healthy).toBe(true)
    expect(fs.backend.version).toBe("0.9.31")
    expect(fs.backend.pinnedVersion).toBe("0.9.31")
    expect(fs.memory.total).toBe(7)
    expect(fs.memory.namespaces).toEqual([])
  })

  test("fullStatus: server down → warn issue, zero memory", async () => {
    const down = new AgentmemoryAdapter({
      home,
      unifyHome,
      baseUrl: "http://127.0.0.1:1",
      runner,
      nodeRunner,
      npmRunner,
    })
    const fs = await down.fullStatus()
    expect(fs.backend.installed).toBe(true)
    expect(fs.backend.healthy).toBe(false)
    expect(fs.backend.issues[0].severity).toBe("warn")
    expect(fs.backend.issues[0].fix).toBe("unify init")
    expect(fs.memory.total).toBe(0)
  })

  test("fullStatus: not installed → error issue", async () => {
    const h2 = await mkdtemp(path.join(os.tmpdir(), "unify-am-adapter-ni-"))
    try {
      const a = new AgentmemoryAdapter({
        home: h2,
        unifyHome: h2,
        baseUrl: base,
        runner,
        nodeRunner,
        npmRunner,
      })
      const fs = await a.fullStatus()
      expect(fs.backend.installed).toBe(false)
      expect(fs.backend.issues[0].severity).toBe("error")
      expect(fs.backend.issues[0].fix).toBe("unify init")
    } finally {
      await rm(h2, { recursive: true, force: true })
    }
  })

  test("sync: server up → count reported, no error", async () => {
    setCount(3)
    const res = await adapter().sync({ dryRun: false })
    expect(res.backend).toBe("agentmemory")
    expect(res.error).toBeUndefined()
    expect(res.changes).toEqual([
      { target: "agentmemory", action: "3 memories indexed (pull-based store — nothing to push)" },
    ])
  })

  test("sync: server down → error", async () => {
    const down = new AgentmemoryAdapter({
      home,
      unifyHome,
      baseUrl: "http://127.0.0.1:1",
      runner,
      nodeRunner,
      npmRunner,
    })
    const res = await down.sync({ dryRun: false })
    expect(res.error).toContain("not running")
  })

  test("doctor: clean when installed + running + pinned", async () => {
    setCount(1)
    const issues = await adapter().doctor()
    expect(issues).toEqual([])
  })

  test("doctor: flags version mismatch (running server reports other version)", async () => {
    setHealthVersion("0.9.30")
    try {
      const issues = await adapter().doctor()
      expect(issues.some((i) => i.message.includes("0.9.30") && i.severity === "warn")).toBe(true)
    } finally {
      setHealthVersion("0.9.31")
    }
  })

  test("doctor: flags node too old", async () => {
    const oldNode: Runner = async (args) => ({ code: 0, stdout: "v18.19.0\n", stderr: "" })
    const a = new AgentmemoryAdapter({ home, unifyHome, baseUrl: base, runner, nodeRunner: oldNode, npmRunner })
    const issues = await a.doctor()
    expect(issues.some((i) => i.message.includes("node") && i.severity === "error")).toBe(true)
  })

  test("install: runs pinned npm install + agentmemory init", async () => {
    calls.length = 0
    const a = new AgentmemoryAdapter({ home, unifyHome, baseUrl: base, runner, nodeRunner, npmRunner })
    await a.install(a.manifest())
    expect(calls).toContainEqual(expect.stringContaining(`npm install`))
    expect(calls.join("\n")).toContain(`${PKG}@0.9.31`)
    expect(calls.join("\n")).toContain("init")
  })
})
