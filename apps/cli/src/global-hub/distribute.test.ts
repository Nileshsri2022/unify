import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { distributeMcp, distributeSkills } from "./distribute"

let root: string
let hub: string
let targets: { tool: string; skillsPath: string }[]

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "unify-hub-dist-"))
  hub = path.join(root, "hub")
  const claudeSkills = path.join(hub, "claude", "skills", "a")
  await mkdir(claudeSkills, { recursive: true })
  await writeFile(path.join(claudeSkills, "SKILL.md"), "# a\n")
  await mkdir(path.join(hub, "claude"), { recursive: true })
  await writeFile(
    path.join(hub, "claude", "mcp.json"),
    JSON.stringify({ mcpServers: { github: { command: "npx" } } }),
  )
  const gemini = path.join(root, "gemini-skills")
  const cursor = path.join(root, "cursor-skills", "a")
  await mkdir(gemini, { recursive: true })
  await mkdir(cursor, { recursive: true })
  await writeFile(path.join(cursor, "SKILL.md"), "# native cursor a\n")
  targets = [
    { tool: "claude", skillsPath: path.join(root, "claude-skills") },
    { tool: "gemini", skillsPath: gemini },
    { tool: "cursor", skillsPath: path.join(root, "cursor-skills") },
  ]
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

describe("global hub distribute", () => {
  test("copies hub skill to empty provider, skips collision, merges MCP without overwriting", async () => {
    const rows = await distributeSkills(hub, targets)
    expect(await readFile(path.join(root, "gemini-skills", "a", "SKILL.md"), "utf-8")).toBe("# a\n")
    expect(rows.find((r) => r.provider === "gemini" && r.skill === "a")?.action).toBe("copied")
    expect(rows.find((r) => r.provider === "cursor" && r.skill === "a")?.action).toBe("skipped")
    expect(await readFile(path.join(root, "cursor-skills", "a", "SKILL.md"), "utf-8")).toBe("# native cursor a\n")

    const home = path.join(root, "home")
    await mkdir(path.join(home, ".cursor"), { recursive: true })
    await writeFile(path.join(home, ".cursor", "mcp.json"), JSON.stringify({ mcpServers: { files: { command: "f" } } }))
    const mcp = await distributeMcp(hub, home, [{ tool: "cursor", configPath: path.join(home, ".cursor", "mcp.json") }])
    const target = JSON.parse(await readFile(path.join(home, ".cursor", "mcp.json"), "utf-8"))
    expect(target.mcpServers.github.command).toBe("npx")
    expect(target.mcpServers.files.command).toBe("f")
    expect(mcp[0].action).toBe("merged")
  })

  test("legacy symlinked hub skill is distributed as a real copy, not a symlink", async () => {
    const real = path.join(root, "real-linked")
    await mkdir(real, { recursive: true })
    await writeFile(path.join(real, "SKILL.md"), "# linked\n")
    await symlink(real, path.join(hub, "claude", "skills", "linked"))
    const destDir = path.join(root, "newprovider-skills")
    await mkdir(destDir, { recursive: true })
    const rows = await distributeSkills(hub, [
      ...targets,
      { tool: "newprovider", skillsPath: destDir },
    ])
    expect(rows.find((r) => r.provider === "newprovider" && r.skill === "linked")?.action).toBe("copied")
    const dest = path.join(destDir, "linked")
    expect((await lstat(dest)).isSymbolicLink()).toBe(false)
    expect(await readFile(path.join(dest, "SKILL.md"), "utf-8")).toBe("# linked\n")
  })
})
