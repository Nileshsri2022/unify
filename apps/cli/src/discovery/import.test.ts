import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { importSkill } from "./import"

let root: string
let from: string
let source: string

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "unify-import-"))
  from = path.join(root, "from")
  source = path.join(root, "source")
  await mkdir(path.join(from, "my-skill"), { recursive: true })
  await writeFile(path.join(from, "my-skill", "SKILL.md"), "# my skill\n")
  await mkdir(source, { recursive: true })
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

describe("importSkill", () => {
  test("copies the skill and leaves the original untouched", async () => {
    const dest = await importSkill({ name: "my-skill", fromDir: from, sourceDir: source })
    expect(dest).toBe(path.join(source, "my-skill"))
    expect(await readFile(path.join(dest, "SKILL.md"), "utf-8")).toBe("# my skill\n")
    expect(await readFile(path.join(from, "my-skill", "SKILL.md"), "utf-8")).toBe("# my skill\n")
  })

  test("rejects path escape, skillshare itself, and an existing destination", async () => {
    await expect(importSkill({ name: "../evil", fromDir: from, sourceDir: source })).rejects.toThrow()
    await expect(importSkill({ name: "skillshare", fromDir: from, sourceDir: source })).rejects.toThrow()
    await expect(importSkill({ name: "my-skill", fromDir: from, sourceDir: source })).rejects.toThrow()
    await expect(importSkill({ name: "nope", fromDir: from, sourceDir: source })).rejects.toThrow()
  })
})
