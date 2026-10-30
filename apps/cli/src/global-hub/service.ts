import { expandTilde } from "@unify/core"
import path from "node:path"
import { DEFAULT_SKILL_PATHS, parseTargetList, resolveSkillshareBinary } from "../adapters/skillshare"
import { realRunner } from "../adapters/runner"
import { MCP_CONFIGS } from "../discovery"
import { collectMcp, collectSkills, hubRoot, type McpCollect, type SkillCollect } from "./index"
import { distributeMcp, distributeSkills, type DistributeRow, type McpDistributeRow } from "./distribute"

/**
 * Shared hub logic for the CLI (`commands/hub.ts`) and the dashboard
 * API (`ui/server.ts` via Orchestrator). Keeping it here — not in the
 * command — is what guarantees CLI and UI always agree.
 */
export async function skillTargets(userHome: string, home: string) {
  try {
    const bin = await resolveSkillshareBinary(home)
    const out = await realRunner(bin)(["target", "list"])
    if (out.code === 0) {
      const parsed = parseTargetList(out.stdout).filter((t) => t.skillsPath)
      if (parsed.length > 0) {
        return parsed.map((t) => ({ tool: t.name, skillsPath: expandTilde(t.skillsPath, userHome) }))
      }
    }
  } catch {
    // fall through to defaults
  }
  return Object.entries(DEFAULT_SKILL_PATHS).map(([tool, p]) => ({
    tool,
    skillsPath: expandTilde(p, userHome),
  }))
}

export function mcpTargets(userHome: string) {
  const seen = new Set<string>()
  const out: { tool: string; configPath: string }[] = []
  for (const c of MCP_CONFIGS) {
    if (c.format !== "json" || seen.has(c.tool)) continue
    seen.add(c.tool)
    out.push({ tool: c.tool, configPath: path.join(userHome, c.rel) })
  }
  return out
}

export interface HubCollectResult {
  hub: string
  skills: SkillCollect[]
  mcp: McpCollect[]
}

export async function hubCollect(userHome: string, home: string): Promise<HubCollectResult> {
  const hub = hubRoot(home)
  const targets = await skillTargets(userHome, home)
  const skills = await collectSkills(hub, targets)
  const mcp = await collectMcp(hub, userHome)
  return { hub, skills, mcp }
}

export interface HubSyncResult {
  collect: HubCollectResult
  distributeSkills: DistributeRow[]
  distributeMcp: McpDistributeRow[]
}

export async function hubSync(userHome: string, home: string): Promise<HubSyncResult> {
  const hub = hubRoot(home)
  const collect = await hubCollect(userHome, home)
  const targets = await skillTargets(userHome, home)
  const skillRows = await distributeSkills(hub, targets)
  const mcpRows = await distributeMcp(hub, userHome, mcpTargets(userHome))
  return { collect, distributeSkills: skillRows, distributeMcp: mcpRows }
}
