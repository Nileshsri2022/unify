/**
 * Phase 1 discovery — read-only by construction.
 *
 * This module never writes, copies, or modifies anything. It only lists
 * directory entries and parses MCP config *names*. Secret values are
 * never returned, logged, or included in any result: hasSecrets is a
 * boolean computed from key names only.
 *
 * Plugins: unify has no verified per-tool plugin location it can name
 * with confidence yet, so plugins are intentionally not invented here.
 * A tool with no verified plugin path is reported as unknown by the
 * caller, not guessed. See the design doc.
 */
import path from "node:path"
import { readdir, readFile } from "node:fs/promises"
import { expandTilde, isDir } from "@unify/core"

export interface DiscoveredSkill {
  name: string
  alreadyShared: boolean
}

export interface SkillRow {
  tool: string
  skillsPath: string
  state: "found" | "missing"
  skills: DiscoveredSkill[]
}

export async function discoverSkills(
  targets: { tool: string; skillsPath: string }[],
  sourceSkills: string[],
): Promise<SkillRow[]> {
  const shared = new Set(sourceSkills)
  const rows: SkillRow[] = []
  for (const t of targets) {
    if (!(await isDir(t.skillsPath))) {
      rows.push({ tool: t.tool, skillsPath: t.skillsPath, state: "missing", skills: [] })
      continue
    }
    let entries: string[] = []
    try {
      const dirents = await readdir(t.skillsPath, { withFileTypes: true })
      entries = dirents
        // Symlinks count too: skillshare itself links skills into
        // target folders, so a directory-only filter would hide it
        // and report a target as having no skills at all.
        .filter((e) => (e.isDirectory() || e.isSymbolicLink()) && !e.name.startsWith("."))
        .map((e) => e.name)
        .sort()
    } catch {
      entries = []
    }
    rows.push({
      tool: t.tool,
      skillsPath: t.skillsPath,
      state: "found",
      skills: entries.map((name) => ({ name, alreadyShared: shared.has(name) })),
    })
  }
  return rows
}

const SECRET_KEYS = ["env", "headers", "apikey", "api_key", "token", "password", "secret"]

function hasSecretKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasSecretKey)
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).some(
      ([k, v]) => SECRET_KEYS.includes(k.toLowerCase()) || hasSecretKey(v),
    )
  }
  return false
}

export function parseMcpJson(text: string): { names: string[]; hasSecrets: boolean } {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return { names: [], hasSecrets: false }
  }
  const servers =
    data && typeof data === "object"
      ? ((data as Record<string, unknown>).mcpServers as Record<string, unknown> | undefined)
      : undefined
  if (!servers || typeof servers !== "object") return { names: [], hasSecrets: false }
  return { names: Object.keys(servers).sort(), hasSecrets: hasSecretKey(servers) }
}

export function parseMcpToml(text: string): { names: string[]; hasSecrets: boolean } {
  const names: string[] = []
  for (const line of text.split("\n")) {
    const m = /^\s*\[mcp_servers\.([^\]]+)\]\s*$/.exec(line)
    if (m) names.push(m[1].trim().replace(/^["']|["']$/g, ""))
  }
  // TOML servers commonly carry an env table; treat its presence as secrets
  // without ever reading its values.
  const hasSecrets = /\[mcp_servers\.[^\]]+\.env\]/.test(text) || /\benv\s*=/.test(text)
  return { names: [...new Set(names)].sort(), hasSecrets }
}

export interface McpConfig {
  tool: string
  rel: string
  format: "json" | "toml"
}

/**
 * MCP config locations unify can name with confidence. Absent files are
 * reported as missing by discoverMcp; unknown tools are not guessed.
 */
export const MCP_CONFIGS: McpConfig[] = [
  { tool: "claude", rel: ".claude.json", format: "json" },
  { tool: "claude", rel: ".claude/settings.json", format: "json" },
  { tool: "gemini", rel: ".gemini/settings.json", format: "json" },
  { tool: "cursor", rel: ".cursor/mcp.json", format: "json" },
  { tool: "windsurf", rel: ".codeium/windsurf/mcp_config.json", format: "json" },
  { tool: "codex", rel: ".codex/config.toml", format: "toml" },
]

export interface McpFinding {
  tool: string
  configPath: string
  state: "found" | "missing" | "unparsable"
  servers: string[]
  hasSecrets: boolean
}

export async function discoverMcp(home: string): Promise<McpFinding[]> {
  const findings: McpFinding[] = []
  for (const cfg of MCP_CONFIGS) {
    const full = path.join(home, cfg.rel)
    let text: string
    try {
      text = await readFile(full, "utf-8")
    } catch {
      findings.push({ tool: cfg.tool, configPath: full, state: "missing", servers: [], hasSecrets: false })
      continue
    }
    const parsed = cfg.format === "json" ? parseMcpJson(text) : parseMcpToml(text)
    // A file that exists but yields no servers and is not valid JSON/TOML
    // for its format is unparsable, not silently empty.
    let unparsable = false
    if (cfg.format === "json") {
      try {
        JSON.parse(text)
      } catch {
        unparsable = true
      }
    }
    findings.push({
      tool: cfg.tool,
      configPath: full,
      state: unparsable ? "unparsable" : "found",
      servers: parsed.names,
      hasSecrets: parsed.hasSecrets,
    })
  }
  return findings
}

export { expandTilde }
