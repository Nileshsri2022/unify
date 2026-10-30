import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  discoverMcp,
  discoverSkills,
  parseMcpJson,
  parseMcpToml,
} from "./index"

let root: string

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "unify-discover-"))
  await mkdir(path.join(root, ".claude", "skills", "my-skill"), { recursive: true })
  await mkdir(path.join(root, ".claude", "skills", "skillshare"), { recursive: true })
  await writeFile(path.join(root, ".claude", "skills", "my-skill", "SKILL.md"), "# hi\n")
  await writeFile(
    path.join(root, ".claude.json"),
    JSON.stringify({
      mcpServers: {
        github: { command: "npx", args: ["-y", "mcp"], env: { GITHUB_TOKEN: "secret-value-123" } },
        files: { command: "files-mcp" },
      },
    }),
  )
  await mkdir(path.join(root, ".codex"), { recursive: true })
  await writeFile(
    path.join(root, ".codex", "config.toml"),
    '[mcp_servers.codex-search]\ncommand = "search-mcp"\n',
  )
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

describe("discoverSkills (read-only)", () => {
  test("lists a skill as importable and skillshare as already-shared, missing dir as missing", async () => {
    const rows = await discoverSkills(
      [
        { tool: "claude", skillsPath: path.join(root, ".claude", "skills") },
        { tool: "gemini", skillsPath: path.join(root, ".gemini", "skills") },
      ],
      ["skillshare"],
    )
    const claude = rows.find((r) => r.tool === "claude")!
    expect(claude.state).toBe("found")
    expect(claude.skills.find((s) => s.name === "my-skill")?.alreadyShared).toBe(false)
    expect(claude.skills.find((s) => s.name === "skillshare")?.alreadyShared).toBe(true)
    expect(rows.find((r) => r.tool === "gemini")?.state).toBe("missing")
  })
})

describe("MCP discovery (names only, never values)", () => {
  test("JSON mcpServers: names returned, secret values never appear", () => {
    const r = parseMcpJson(
      JSON.stringify({ mcpServers: { a: { env: { K: "topsecret" } }, b: {} } }),
    )
    expect(r.names).toEqual(["a", "b"])
    expect(r.hasSecrets).toBe(true)
    expect(JSON.stringify(r)).not.toContain("topsecret")
  })

  test("TOML mcp_servers: names returned, unparsable config reported not skipped", async () => {
    expect(parseMcpToml('[mcp_servers.search]\ncommand="x"\n').names).toEqual(["search"])
    const findings = await discoverMcp(root)
    const claude = findings.find((f) => f.tool === "claude")!
    expect(claude.state).toBe("found")
    expect(claude.servers).toEqual(["files", "github"])
    expect(JSON.stringify(findings)).not.toContain("secret-value-123")
    expect(findings.find((f) => f.tool === "codex")?.servers).toEqual(["codex-search"])
  })
})
