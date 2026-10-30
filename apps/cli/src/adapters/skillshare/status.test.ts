import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { readFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { Runner } from "../runner"
import { SkillshareAdapter } from "./index"

const FX = (name: string) =>
  readFile(new URL(`../../../testdata/skillshare/0.28.0/${name}`, import.meta.url), "utf8")

function fixtureRunner(overrides: Record<string, { code: number; stdout?: string; stderr?: string }> = {}): Runner {
  return async (args: string[]) => {
    const key = args.join(" ")
    const hit = overrides[key]
    if (hit) return { code: hit.code, stdout: hit.stdout ?? "", stderr: hit.stderr ?? "" }
    switch (key) {
      case "--version":
        return { code: 0, stdout: await FX("version.out"), stderr: "" }
      case "target list":
        return { code: 0, stdout: await FX("target-list.out"), stderr: "" }
      case "sync --dry-run --json":
        return { code: 0, stdout: await FX("sync-dryrun.json"), stderr: "" }
      case "sync --json":
        return { code: 0, stdout: await FX("sync-apply.json"), stderr: "" }
      default:
        return { code: 1, stdout: "", stderr: `unhandled fixture call: ${key}` }
    }
  }
}

/**
 * Build a fake user home:
 *  - source skills: code-review + skillshare
 *  - claude + gemini targets fully linked (in-sync)
 *  - universal target missing `skillshare` (drift)
 *  - .cursor installed on machine but not a managed target
 */
async function buildHome(): Promise<string> {
  const h = await mkdtemp(path.join(os.tmpdir(), "unify-sh-status-"))
  const mk = (rel: string) => mkdir(path.join(h, rel), { recursive: true })
  const src = path.join(h, ".config", "skillshare", "skills")
  await mkdir(path.join(src, "code-review"), { recursive: true })
  await writeFile(path.join(src, "code-review", "SKILL.md"), "---\nname: code-review\n---\n")
  await mkdir(path.join(src, "skillshare"), { recursive: true })
  await writeFile(path.join(src, "skillshare", "SKILL.md"), "---\nname: skillshare\n---\n")

  for (const d of [".claude/skills/code-review", ".claude/skills/skillshare"]) await mk(d)
  for (const d of [".gemini/skills/code-review", ".gemini/skills/skillshare"]) await mk(d)
  await mk(".agents/skills/code-review") // universal: skillshare NOT linked → drift
  await mk(".cursor") // installed, unmanaged
  return h
}

describe("SkillshareAdapter (fixture-backed)", () => {
  let home: string

  beforeAll(async () => {
    home = await buildHome()
  })
  afterAll(async () => {
    await rm(home, { recursive: true, force: true })
  })

  test("detect: reports installed + version from --version", async () => {
    const a = new SkillshareAdapter({ runner: fixtureRunner(), home, binPath: "/fake/skillshare" })
    const det = await a.detect()
    expect(det.installed).toBe(true)
    expect(det.version).toBe("0.28.0")
    expect(det.path).toBe("/fake/skillshare")
  })

  test("fullStatus: in-sync, drift, missing, not-installed rows", async () => {
    const a = new SkillshareAdapter({ runner: fixtureRunner(), home })
    const fs = await a.fullStatus()

    expect(fs.skills).toEqual(["code-review", "skillshare"])
    expect(fs.backend.installed).toBe(true)
    expect(fs.backend.version).toBe("0.28.0")
    expect(fs.backend.pinnedVersion).toBe("0.28.0")

    const byName = Object.fromEntries(fs.targets.map((t) => [t.target, t]))
    expect(byName["claude"].state).toBe("in-sync")
    expect(byName["gemini"].state).toBe("in-sync")
    expect(byName["universal"].state).toBe("drift")
    expect(byName["universal"].detail).toContain("skillshare")
    expect(byName["cursor"].state).toBe("missing")
    expect(byName["codex"].state).toBe("not-installed")
    expect(byName["windsurf"].state).toBe("not-installed")

    expect(fs.backend.healthy).toBe(false)
    const fixes = fs.backend.issues.map((i) => i.fix)
    expect(fixes).toContain("unify sync")
  })

  test("sync (dryRun): maps skillshare sync --json to SyncResult", async () => {
    const a = new SkillshareAdapter({ runner: fixtureRunner(), home })
    const res = await a.sync({ dryRun: true })
    expect(res.backend).toBe("skillshare")
    expect(res.dryRun).toBe(true)
    expect(res.error).toBeUndefined()
    expect(res.changes).toEqual([
      { target: "claude", action: "2 linked, 0 updated, 0 pruned" },
      { target: "gemini", action: "2 linked, 0 updated, 0 pruned" },
      { target: "universal", action: "2 linked, 0 updated, 0 pruned" },
    ])
  })

  test("sync failure surfaces error string", async () => {
    const a = new SkillshareAdapter({
      runner: fixtureRunner({ "sync --json": { code: 1, stdout: "", stderr: "boom: no source" } }),
      home,
    })
    const res = await a.sync({ dryRun: false })
    expect(res.changes).toEqual([])
    expect(res.error).toContain("boom")
  })

  test("doctor: no issues when everything in-sync", async () => {
    const home2 = await buildHome()
    const full = path.join(home2, ".agents", "skills", "skillshare")
    await mkdir(full, { recursive: true })
    await rm(path.join(home2, ".cursor"), { recursive: true, force: true })
    const a = new SkillshareAdapter({ runner: fixtureRunner(), home: home2 })
    const issues = await a.doctor()
    expect(issues).toEqual([])
    await rm(home2, { recursive: true, force: true })
  })

  test("doctor: flags drift + unmanaged installed tool", async () => {
    const a = new SkillshareAdapter({ runner: fixtureRunner(), home })
    const issues = await a.doctor()
    const msgs = issues.map((i) => i.message)
    expect(msgs.some((m) => m.includes("universal"))).toBe(true)
    expect(msgs.some((m) => m.includes("cursor"))).toBe(true)
    expect(issues.every((i) => i.severity === "warn")).toBe(true)
  })

  test("doctor: version mismatch warning", async () => {
    const a = new SkillshareAdapter({
      runner: fixtureRunner({ "--version": { code: 0, stdout: "skillshare v9.9.9" } }),
      home,
    })
    const issues = await a.doctor()
    expect(issues.some((i) => i.message.includes("9.9.9") && i.fix === "unify backends update")).toBe(true)
  })

  test("detect: not installed when binary fails", async () => {
    const a = new SkillshareAdapter({
      runner: fixtureRunner({ "--version": { code: 127, stdout: "", stderr: "not found" } }),
      home,
    })
    const det = await a.detect()
    expect(det.installed).toBe(false)
    const st = await a.status()
    expect(st.installed).toBe(false)
    expect(st.issues[0].fix).toBe("unify init")
  })
})
