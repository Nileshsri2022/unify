import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { collectMcp, collectSkills, hubRoot } from "./index"

let root: string
let home: string
let hub: string

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "unify-hub-"))
  home = path.join(root, "home")
  hub = hubRoot(path.join(root, "unify"))
  await mkdir(path.join(home, ".claude", "skills", "a"), { recursive: true })
  await writeFile(path.join(home, ".claude", "skills", "a", "SKILL.md"), "# a\n")
  // codex and universal share one physical skills dir
  await mkdir(path.join(home, ".agents", "skills"), { recursive: true })
  await writeFile(
    path.join(home, ".claude.json"),
    JSON.stringify({ mcpServers: { github: { command: "npx", env: { TOKEN: "topsecret" } } } }),
  )
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

describe("global hub collect", () => {
  test("hub root is under unify home, skills collected once per physical path, MCP secrets stripped", async () => {
    expect(hub).toBe(path.join(root, "unify", "global"))
    const skills = await collectSkills(hub, [
      { tool: "claude", skillsPath: path.join(home, ".claude", "skills") },
      { tool: "codex", skillsPath: path.join(home, ".agents", "skills") },
      { tool: "universal", skillsPath: path.join(home, ".agents", "skills") },
      { tool: "gemini", skillsPath: path.join(home, ".gemini", "skills") },
    ])
    expect(await readFile(path.join(hub, "claude", "skills", "a", "SKILL.md"), "utf-8")).toBe("# a\n")
    expect(skills.find((s) => s.provider === "gemini")?.state).toBe("missing")
    // shared physical path: codex collected, universal reported as shared, not duplicated
    expect(skills.find((s) => s.provider === "universal")?.state).toBe("shared")
    const mcp = await collectMcp(hub, home)
    const claudeMcp = JSON.parse(await readFile(path.join(hub, "claude", "mcp.json"), "utf-8"))
    expect(claudeMcp.mcpServers.github.command).toBe("npx")
    expect(JSON.stringify(claudeMcp)).not.toContain("topsecret")
    const meta = JSON.parse(await readFile(path.join(hub, "claude", "mcp-meta.json"), "utf-8"))
    expect(meta.github.hadSecrets).toBe(true)
    expect(mcp.find((m) => m.provider === "claude")?.state).toBe("found")
  })

  test("symlinked skill is collected as a real copy, and a second collect does not EINVAL", async () => {
    // Mirrors Windows: skillshare links its skill as a symlink into each
    // provider's skills folder (e.g. %APPDATA%\skillshare\skills\skillshare).
    const real = path.join(root, "source", "skillshare")
    await mkdir(real, { recursive: true })
    await writeFile(path.join(real, "SKILL.md"), "# skillshare\n")
    const providerSkills = path.join(home, ".antigravity", "skills")
    await mkdir(providerSkills, { recursive: true })
    await symlink(real, path.join(providerSkills, "skillshare"))
    const targets = [{ tool: "antigravity", skillsPath: providerSkills }]
    await collectSkills(hub, targets)
    const dest = path.join(hub, "antigravity", "skills", "skillshare")
    expect((await lstat(dest)).isSymbolicLink()).toBe(false)
    expect(await readFile(path.join(dest, "SKILL.md"), "utf-8")).toBe("# skillshare\n")
    // Second collect must not throw ERR_FS_CP_EINVAL (the reported bug:
    // cp of a symlink src to a symlink dest resolving to the same folder).
    await collectSkills(hub, targets)
    expect((await lstat(dest)).isSymbolicLink()).toBe(false)
    expect(await readFile(path.join(dest, "SKILL.md"), "utf-8")).toBe("# skillshare\n")
  })

  test("legacy hub symlink dest is repaired to a real copy on collect", async () => {
    const real = path.join(root, "source2", "linked")
    await mkdir(real, { recursive: true })
    await writeFile(path.join(real, "SKILL.md"), "# linked\n")
    const providerSkills = path.join(home, ".legacy", "skills")
    await mkdir(providerSkills, { recursive: true })
    await symlink(real, path.join(providerSkills, "linked"))
    const dest = path.join(hub, "legacy", "skills", "linked")
    await mkdir(path.dirname(dest), { recursive: true })
    await symlink(real, dest) // what the old cp left in the hub
    await collectSkills(hub, [{ tool: "legacy", skillsPath: providerSkills }])
    expect((await lstat(dest)).isSymbolicLink()).toBe(false)
    expect(await readFile(path.join(dest, "SKILL.md"), "utf-8")).toBe("# linked\n")
  })
})
