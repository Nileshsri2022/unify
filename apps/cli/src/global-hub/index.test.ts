import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
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
})
