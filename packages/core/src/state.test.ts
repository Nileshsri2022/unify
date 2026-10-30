import { describe, expect, test } from "bun:test"
import { mkdtemp, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { ensureHome, expandTilde, pathsFor, unifyHome } from "./state"

describe("state paths", () => {
  test("pathsFor resolves all paths under the given home", () => {
    const p = pathsFor("/tmp/u")
    expect(p.home).toBe("/tmp/u")
    expect(p.config).toBe("/tmp/u/unify.yaml")
    expect(p.lock).toBe("/tmp/u/backends.lock.json")
    expect(p.lastSync).toBe("/tmp/u/state/last-sync.json")
    expect(p.backendsBin).toBe("/tmp/u/backends")
    expect(p.cache).toBe("/tmp/u/cache")
  })

  test("expandTilde handles forward-slash and Windows backslash tilde paths", () => {
    expect(expandTilde("~/.claude/skills", "/home/u")).toBe("/home/u/.claude/skills")
    // skillshare on Windows reports paths like ~\.config\opencode\skills
    expect(expandTilde("~\\.config\\opencode\\skills", "/home/u")).toBe(
      "/home/u/.config/opencode/skills",
    )
    expect(expandTilde("~", "/home/u")).toBe("/home/u")
    expect(expandTilde("/absolute/path", "/home/u")).toBe("/absolute/path")
  })

  test("unifyHome respects UNIFY_HOME env, else ~/.unify", () => {
    const prev = process.env.UNIFY_HOME
    process.env.UNIFY_HOME = "/tmp/u2"
    try {
      expect(unifyHome()).toBe("/tmp/u2")
    } finally {
      if (prev === undefined) delete process.env.UNIFY_HOME
      else process.env.UNIFY_HOME = prev
    }
  })

  test("ensureHome creates state/backends/cache dirs and sets home to 0700", async () => {
    const tmp = await mkdtemp(path.join(tmpdir(), "unify-home-"))
    try {
      await ensureHome(tmp)
      const homeStat = await stat(tmp)
      expect(homeStat.mode & 0o777).toBe(0o700)
      for (const sub of ["state", "backends", "cache"]) {
        const s = await stat(path.join(tmp, sub))
        expect(s.isDirectory()).toBe(true)
      }
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  })
})
