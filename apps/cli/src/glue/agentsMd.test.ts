import { describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import type { MemoryClient, RecallResult } from "../adapters/agentmemory/client"
import { injectAgentsMdIntoMemory, AGENTS_MD_GLAUE_ACTION } from "./agentsMd"

/** Fake MemoryClient: records saves, serves recall from its own store. */
class FakeMemory {
  store: { id: string; content: string; agentId?: string; concepts?: string[] }[] = []
  saves: { content: string; concepts?: string[]; agentId?: string }[] = []
  recalls: { query: string; limit?: number; agentId?: string }[] = []
  n = 0

  async livez() {
    return { status: "ok" }
  }
  async health() {
    return { status: "healthy", version: "0.9.31" }
  }
  async memoryCount() {
    return this.store.length
  }
  async save(content: string, concepts?: string[], agentId?: string): Promise<string> {
    const id = `mem_fake_${++this.n}`
    this.store.push({ id, content, agentId, concepts })
    this.saves.push({ content, concepts, agentId })
    return id
  }
  async recall(query: string, limit = 10, agentId?: string): Promise<RecallResult[]> {
    this.recalls.push({ query, limit, agentId })
    const scoped = agentId ? this.store.filter((m) => m.agentId === agentId) : this.store
    const q = query.toLowerCase()
    return scoped
      .filter((m) => m.content.toLowerCase().includes(q))
      .slice(0, limit)
      .map((m) => ({ obsId: m.id, score: 1, title: m.content.slice(0, 80), type: "fact" }))
  }
}

async function withAgentsMd(content: string | null, fn: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(path.join(tmpdir(), "unify-glue-"))
  if (content !== null) await writeFile(path.join(dir, "AGENTS.md"), content, "utf8")
  try {
    await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

const RULES = "# Rules\n- Always run tests before commit\n"

describe("glue: inject-agents-md-into-memory", () => {
  test("action id constant matches DESIGN §5", () => {
    expect(AGENTS_MD_GLAUE_ACTION).toBe("inject-agents-md-into-memory")
  })

  test("missing AGENTS.md → skipped (reason: missing), no save", async () => {
    await withAgentsMd(null, async (dir) => {
      const client = new FakeMemory()
      const r = await injectAgentsMdIntoMemory({
        unifyHome: dir,
        profileName: "work",
        namespace: "work",
        client: client as unknown as MemoryClient,
      })
      expect(r.injected).toBe(false)
      expect(r.reason).toBe("missing")
      expect(client.saves).toHaveLength(0)
    })
  })

  test("first run: saves marker-tagged snapshot scoped to the namespace", async () => {
    await withAgentsMd(RULES, async (dir) => {
      const client = new FakeMemory()
      const r = await injectAgentsMdIntoMemory({
        unifyHome: dir,
        profileName: "work",
        namespace: "work",
        client: client as unknown as MemoryClient,
      })
      expect(r.injected).toBe(true)
      expect(r.hash).toHaveLength(12)
      expect(client.saves).toHaveLength(1)
      const s = client.saves[0]
      expect(s.content).toContain(`[unify:hash=${r.hash}]`)
      expect(s.content).toContain(RULES.trim())
      expect(s.content).toContain("profile: work")
      expect(s.concepts).toEqual(["agents-md", "glue"])
      expect(s.agentId).toBe("work")
    })
  })

  test("second run with unchanged content: up-to-date, no save", async () => {
    await withAgentsMd(RULES, async (dir) => {
      const client = new FakeMemory()
      const d = {
        unifyHome: dir,
        profileName: "work",
        namespace: "work",
        client: client as unknown as MemoryClient,
      }
      const first = await injectAgentsMdIntoMemory(d)
      const second = await injectAgentsMdIntoMemory(d)
      expect(first.injected).toBe(true)
      expect(second.injected).toBe(false)
      expect(second.reason).toBe("up-to-date")
      expect(second.hash).toBe(first.hash)
      expect(client.saves).toHaveLength(1)
      // idempotency check is namespaced: recall carried the agentId
      expect(client.recalls.every((r) => r.agentId === "work")).toBe(true)
    })
  })

  test("changed content: re-injects with a new hash", async () => {
    await withAgentsMd(RULES, async (dir) => {
      const client = new FakeMemory()
      const d = {
        unifyHome: dir,
        profileName: "work",
        namespace: "work",
        client: client as unknown as MemoryClient,
      }
      const first = await injectAgentsMdIntoMemory(d)
      await writeFile(path.join(dir, "AGENTS.md"), RULES + "- New rule\n")
      const second = await injectAgentsMdIntoMemory(d)
      expect(second.injected).toBe(true)
      expect(second.hash).not.toBe(first.hash)
      expect(client.saves).toHaveLength(2)
    })
  })

  test("different namespaces do not share up-to-date state", async () => {
    await withAgentsMd(RULES, async (dir) => {
      const client = new FakeMemory()
      const work = {
        unifyHome: dir,
        profileName: "work",
        namespace: "work",
        client: client as unknown as MemoryClient,
      }
      const personal = { ...work, profileName: "personal", namespace: "personal" }
      const a = await injectAgentsMdIntoMemory(work)
      const b = await injectAgentsMdIntoMemory(personal)
      expect(a.injected).toBe(true)
      expect(b.injected).toBe(true) // personal has no snapshot yet
      expect(client.saves).toHaveLength(2)
      expect(client.saves.map((s) => s.agentId)).toEqual(["work", "personal"])
    })
  })

  test("overlong AGENTS.md is truncated with a note", async () => {
    const big = "# Rules\n" + "line\n".repeat(3000) // ~15 KB
    await withAgentsMd(big, async (dir) => {
      const client = new FakeMemory()
      const r = await injectAgentsMdIntoMemory({
        unifyHome: dir,
        profileName: "work",
        namespace: "work",
        client: client as unknown as MemoryClient,
      })
      expect(r.injected).toBe(true)
      expect(client.saves[0].content.length).toBeLessThanOrEqual(8000 + 200)
      expect(client.saves[0].content).toContain("[truncated")
    })
  })
})
