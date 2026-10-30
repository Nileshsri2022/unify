/**
 * Hub distribute: hub -> every other provider. Never overwrites.
 * A skill or MCP server already present in a provider is skipped
 * and reported, never overwritten or pruned.
 */
import path from "node:path"
import { cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import { isDir } from "@unify/core"

export interface DistributeRow {
  provider: string
  skill: string
  action: "copied" | "skipped"
}

export async function distributeSkills(
  hub: string,
  targets: { tool: string; skillsPath: string }[],
): Promise<DistributeRow[]> {
  const rows: DistributeRow[] = []
  for (const t of targets) {
    const hubSkillsDir = path.join(hub, t.tool, "skills")
    // Hub skills for this provider are its own — distribute every
    // *other* provider's hub skills into this provider.
    const providers = await readdir(hub, { withFileTypes: true }).catch(() => [])
    for (const p of providers) {
      if (!p.isDirectory() || p.name === t.tool || p.name === "memory") continue
      const srcDir = path.join(hub, p.name, "skills")
      const skills = await readdir(srcDir, { withFileTypes: true }).catch(() => [])
      for (const s of skills) {
        if (!s.isDirectory() && !s.isSymbolicLink()) continue
        const dest = path.join(t.skillsPath, s.name)
        if (await isDir(dest)) {
          rows.push({ provider: t.tool, skill: s.name, action: "skipped" })
          continue
        }
        await mkdir(t.skillsPath, { recursive: true })
        // Same symlink rule as collect: a legacy hub skill may itself
        // be a symlink, and copying it as a symlink would recreate
        // the EINVAL failure in the provider. Dereference so the
        // provider gets a real copy. (A real existing dest is skipped
        // above, so this never overwrites a provider's own skill.)
        await cp(path.join(srcDir, s.name), dest, { recursive: true, force: true, dereference: true })
        rows.push({ provider: t.tool, skill: s.name, action: "copied" })
      }
    }
  }
  return rows
}

export interface McpDistributeRow {
  provider: string
  server: string
  action: "merged" | "skipped"
}

export async function distributeMcp(
  hub: string,
  _home: string,
  targets: { tool: string; configPath: string }[],
): Promise<McpDistributeRow[]> {
  const rows: McpDistributeRow[] = []
  for (const t of targets) {
    let target: Record<string, unknown> = { mcpServers: {} }
    try {
      target = JSON.parse(await readFile(t.configPath, "utf-8")) as Record<string, unknown>
    } catch {
      // missing target config: start fresh
    }
    if (!target.mcpServers || typeof target.mcpServers !== "object") target.mcpServers = {}
    const servers = target.mcpServers as Record<string, unknown>
    let changed = false
    const providers = await readdir(hub, { withFileTypes: true }).catch(() => [])
    for (const p of providers) {
      if (!p.isDirectory() || p.name === t.tool || p.name === "memory") continue
      let hubData: Record<string, unknown>
      try {
        hubData = JSON.parse(await readFile(path.join(hub, p.name, "mcp.json"), "utf-8")) as Record<string, unknown>
      } catch {
        continue
      }
      const hubServers = (hubData.mcpServers ?? {}) as Record<string, unknown>
      for (const [name, def] of Object.entries(hubServers)) {
        if (name in servers) {
          rows.push({ provider: t.tool, server: name, action: "skipped" })
          continue
        }
        servers[name] = def
        changed = true
        rows.push({ provider: t.tool, server: name, action: "merged" })
      }
    }
    if (changed) {
      await mkdir(path.dirname(t.configPath), { recursive: true })
      await writeFile(t.configPath, JSON.stringify(target, null, 2) + "\n", "utf-8")
    }
  }
  return rows
}
