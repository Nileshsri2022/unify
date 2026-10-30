/**
 * Global hub — one directory under the user's unify home, with a
 * per-provider subdirectory for skills, MCP, and (snapshot-only) memory.
 *
 * Collect writes to the hub only, never to a provider. Distribute
 * never overwrites an existing skill or MCP server — collisions are
 * skipped and reported. Hub MCP files never contain secrets.
 */
import path from "node:path"
import { cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import { isDir } from "@unify/core"
import { MCP_CONFIGS } from "../discovery"
import { hasSecretKey, stripSecrets } from "../discovery/mcp-import"

export function hubRoot(unifyHome: string): string {
  return path.join(unifyHome, "global")
}

export interface SkillCollect {
  provider: string
  state: "found" | "missing" | "shared"
  skills: string[]
}

export async function collectSkills(
  hub: string,
  targets: { tool: string; skillsPath: string }[],
): Promise<SkillCollect[]> {
  const seenPaths = new Set<string>()
  const rows: SkillCollect[] = []
  for (const t of targets) {
    const resolved = path.resolve(t.skillsPath)
    if (seenPaths.has(resolved)) {
      rows.push({ provider: t.tool, state: "shared", skills: [] })
      continue
    }
    if (!(await isDir(t.skillsPath))) {
      rows.push({ provider: t.tool, state: "missing", skills: [] })
      continue
    }
    seenPaths.add(resolved)
    const dirents = await readdir(t.skillsPath, { withFileTypes: true })
    const skills = dirents
      .filter((e) => (e.isDirectory() || e.isSymbolicLink()) && !e.name.startsWith("."))
      .map((e) => e.name)
      .sort()
    for (const s of skills) {
      const dest = path.join(hub, t.tool, "skills", s)
      await mkdir(path.dirname(dest), { recursive: true })
      await cp(path.join(t.skillsPath, s), dest, { recursive: true, force: true })
    }
    rows.push({ provider: t.tool, state: "found", skills })
  }
  return rows
}

export interface McpCollect {
  provider: string
  state: "found" | "missing" | "unparsable" | "unsupported"
  servers: string[]
}

export async function collectMcp(hub: string, home: string): Promise<McpCollect[]> {
  const rows: McpCollect[] = []
  const seenTools = new Set<string>()
  for (const cfg of MCP_CONFIGS) {
    if (seenTools.has(cfg.tool)) continue
    seenTools.add(cfg.tool)
    if (cfg.format !== "json") {
      rows.push({ provider: cfg.tool, state: "unsupported", servers: [] })
      continue
    }
    const full = path.join(home, cfg.rel)
    let text: string
    try {
      text = await readFile(full, "utf-8")
    } catch {
      rows.push({ provider: cfg.tool, state: "missing", servers: [] })
      continue
    }
    let data: Record<string, unknown>
    try {
      data = JSON.parse(text) as Record<string, unknown>
    } catch {
      rows.push({ provider: cfg.tool, state: "unparsable", servers: [] })
      continue
    }
    const servers = (data.mcpServers ?? {}) as Record<string, unknown>
    const stripped: Record<string, unknown> = {}
    const meta: Record<string, { hadSecrets: boolean }> = {}
    for (const [name, def] of Object.entries(servers)) {
      stripped[name] = stripSecrets(def)
      meta[name] = { hadSecrets: hasSecretKey(def) }
    }
    const dir = path.join(hub, cfg.tool)
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, "mcp.json"), JSON.stringify({ mcpServers: stripped }, null, 2) + "\n", "utf-8")
    await writeFile(path.join(dir, "mcp-meta.json"), JSON.stringify(meta, null, 2) + "\n", "utf-8")
    rows.push({ provider: cfg.tool, state: "found", servers: Object.keys(stripped).sort() })
  }
  return rows
}
