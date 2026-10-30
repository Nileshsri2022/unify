import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { importMcpServer } from "./mcp-import"

let root: string
let from: string
let to: string

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "unify-mcp-import-"))
  from = path.join(root, "from.json")
  to = path.join(root, "to.json")
  await writeFile(
    from,
    JSON.stringify({
      mcpServers: {
        github: {
          command: "npx",
          args: ["-y", "gh-mcp"],
          env: { GITHUB_TOKEN: "topsecret-123" },
          headers: { Authorization: "Bearer xyz" },
          nested: { apiKey: "nested-secret" },
        },
      },
    }),
  )
  await writeFile(to, JSON.stringify({ mcpServers: { files: { command: "files-mcp" } } }))
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

describe("importMcpServer (secrets never copied)", () => {
  test("imports the server without any secret value, preserves other servers, leaves source unchanged", async () => {
    const r = await importMcpServer({ server: "github", fromPath: from, toPath: to })
    expect(r.hadSecrets).toBe(true)
    const target = JSON.parse(await readFile(to, "utf-8"))
    expect(target.mcpServers.files.command).toBe("files-mcp")
    expect(target.mcpServers.github.command).toBe("npx")
    expect(JSON.stringify(target)).not.toContain("topsecret-123")
    expect(JSON.stringify(target)).not.toContain("Bearer xyz")
    expect(JSON.stringify(target)).not.toContain("nested-secret")
    const source = await readFile(from, "utf-8")
    expect(source).toContain("topsecret-123")
    await expect(importMcpServer({ server: "github", fromPath: from, toPath: to })).rejects.toThrow()
    await expect(importMcpServer({ server: "nope", fromPath: from, toPath: to })).rejects.toThrow()
  })
})
