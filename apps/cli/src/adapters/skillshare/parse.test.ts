import { describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { parseSkillList, parseSyncJson, parseTargetList, parseVersion } from "./parse"

const fixture = (name: string): Promise<string> =>
  readFile(new URL(`../../../testdata/skillshare/0.28.0/${name}`, import.meta.url), "utf8")

describe("parseVersion", () => {
  test("parses real --version output", async () => {
    const out = await fixture("version.out")
    expect(parseVersion(out).version).toBe("0.28.0")
  })

  test("throws on garbage", () => {
    expect(() => parseVersion("hello world")).toThrow(/unrecognized/)
  })
})

describe("parseTargetList", () => {
  test("parses real target list output", async () => {
    const out = await fixture("target-list.out")
    const targets = parseTargetList(out)
    expect(targets.map((t) => t.name)).toEqual(["claude", "gemini", "universal"])
    expect(targets[0].skillsPath).toBe("~/.claude/skills")
    expect(targets[0].agentsPath).toBe("~/.claude/agents")
    expect(targets[1].agentsPath).toBeUndefined()
  })

  test("handles empty output", () => {
    expect(parseTargetList("")).toEqual([])
  })
})

describe("parseSyncJson", () => {
  test("parses dry-run fixture", async () => {
    const out = await fixture("sync-dryrun.json")
    const d = parseSyncJson(out)
    expect(d.dryRun).toBe(true)
    expect(d.targets).toBe(3)
    expect(d.details).toHaveLength(3)
    expect(d.details[0]).toEqual({
      name: "claude",
      mode: "merge",
      linked: 2,
      updated: 0,
      pruned: 0,
    })
  })

  test("parses apply fixture", async () => {
    const out = await fixture("sync-apply.json")
    expect(parseSyncJson(out).dryRun).toBe(false)
  })
})

describe("parseSkillList", () => {
  test("parses list --json fixture", async () => {
    const out = await fixture("list.json")
    expect(parseSkillList(out)).toEqual(["code-review", "skillshare"])
  })
})
