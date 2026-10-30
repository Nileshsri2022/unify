import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { RestMemoryClient, ServerDownError, AuthError } from "./client"

const FX = (name: string) =>
  readFile(new URL(`../../../testdata/agentmemory/0.9.31/${name}`, import.meta.url), "utf8")

const SECRET = "test-secret"
let server: ReturnType<typeof Bun.serve>
let base: string
let capturedRemember: Record<string, unknown> | null = null
let capturedSearch: Record<string, unknown> | null = null
let capturedSearchUrl: string | null = null

beforeAll(async () => {
  const livez = await FX("livez.json")
  const health = await FX("health.json")
  const status = await FX("status.json")
  const remember = await FX("remember.json")
  const smartSearch = await FX("smart-search.json")

  server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url)
      const authorized = req.headers.get("authorization") === `Bearer ${SECRET}`
      if (url.pathname === "/agentmemory/livez") {
        return Response.json(JSON.parse(livez))
      }
      if (!authorized) return new Response("unauthorized", { status: 401 })
      switch (url.pathname) {
        case "/agentmemory/health":
          return Response.json(JSON.parse(health))
        case "/agentmemory/status":
          return Response.json(JSON.parse(status))
        case "/agentmemory/remember": {
          const body = await req.json()
          capturedRemember = body
          if (!body.content) return new Response("content required", { status: 400 })
          return Response.json(JSON.parse(remember))
        }
        case "/agentmemory/smart-search": {
          capturedSearch = await req.json()
          capturedSearchUrl = req.url
          return Response.json(JSON.parse(smartSearch))
        }
        default:
          return new Response("not found", { status: 404 })
      }
    },
  })
  base = `http://127.0.0.1:${server.port}`
})

afterAll(() => {
  server.stop(true)
})

const client = () => new RestMemoryClient({ baseUrl: base, secret: SECRET })

describe("RestMemoryClient (fixture-shaped mock server)", () => {
  test("livez: unauthenticated shape", async () => {
    const r = await client().livez()
    expect(r.status).toBe("ok")
    expect(r.viewerPort).toBe(3113)
  })

  test("health: version from fixture", async () => {
    const h = await client().health()
    expect(h.status).toBe("healthy")
    expect(h.version).toBe("0.9.31")
  })

  test("memoryCount: index.memoriesIndexed", async () => {
    expect(await client().memoryCount()).toBe(1)
  })

  test("save: returns memory id", async () => {
    const id = await client().save("test content", ["a", "b"])
    expect(id).toMatch(/^mem_/)
  })

  test("recall: mapped results", async () => {
    const r = await client().recall("fixture capture marker", 5)
    expect(r).toHaveLength(1)
    expect(r[0].obsId).toMatch(/^mem_/)
    expect(r[0].score).toBe(1)
    expect(r[0].title).toBe("fixture capture marker for M2 contract pin")
    expect(r[0].type).toBe("decision")
  })

  test("401 (wrong secret) → AuthError", async () => {
    const bad = new RestMemoryClient({ baseUrl: base, secret: "wrong-secret" })
    await expect(bad.health()).rejects.toBeInstanceOf(AuthError)
  })

  test("no secret → AuthError", async () => {
    const anon = new RestMemoryClient({ baseUrl: base })
    await expect(anon.health()).rejects.toBeInstanceOf(AuthError)
    // livez still works unauthenticated
    expect((await anon.livez()).status).toBe("ok")
  })

  test("connection refused → ServerDownError", async () => {
    const down = new RestMemoryClient({ baseUrl: "http://127.0.0.1:1", secret: SECRET })
    await expect(down.livez()).rejects.toBeInstanceOf(ServerDownError)
  })
})

describe("RestMemoryClient: agentId (profile namespace)", () => {
  test("save: agentId in body when provided, omitted when not", async () => {
    await client().save("x", ["a"], "work")
    expect(capturedRemember?.agentId).toBe("work")
    await client().save("y")
    expect(capturedRemember).not.toHaveProperty("agentId")
  })

  test("recall: agentId in body (NOT query param) when provided, omitted when not", async () => {
    await client().recall("q", 5, "personal")
    expect(capturedSearch?.agentId).toBe("personal")
    // server ignores ?agentId= on smart-search — scope must ride in the body only
    expect(capturedSearchUrl).not.toContain("agentId=")
    await client().recall("q")
    expect(capturedSearch).not.toHaveProperty("agentId")
  })
})
