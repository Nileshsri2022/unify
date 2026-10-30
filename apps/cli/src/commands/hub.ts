import { defineCommand } from "citty"
import { expandTilde, unifyHome } from "@unify/core"
import os from "node:os"
import path from "node:path"
import { collectMcp, collectSkills, hubRoot } from "../global-hub"
import { distributeMcp, distributeSkills } from "../global-hub/distribute"
import { watchHub } from "../global-hub/watch"
import { DEFAULT_SKILL_PATHS, parseTargetList, resolveSkillshareBinary } from "../adapters/skillshare"
import { MCP_CONFIGS } from "../discovery"
import { realRunner } from "../adapters/runner"

async function skillTargets(userHome: string, home: string) {
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

function mcpTargets(userHome: string) {
  const seen = new Set<string>()
  const out: { tool: string; configPath: string }[] = []
  for (const c of MCP_CONFIGS) {
    if (c.format !== "json" || seen.has(c.tool)) continue
    seen.add(c.tool)
    out.push({ tool: c.tool, configPath: path.join(userHome, c.rel) })
  }
  return out
}

async function doCollect(userHome: string, home: string, hub: string) {
  const targets = await skillTargets(userHome, home)
  const skills = await collectSkills(hub, targets)
  const mcp = await collectMcp(hub, userHome)
  console.log(`hub: ${hub}`)
  for (const s of skills) console.log(`  skills ${s.provider}: ${s.state}${s.skills.length ? ` (${s.skills.join(", ")})` : ""}`)
  for (const m of mcp) console.log(`  mcp ${m.provider}: ${m.state}${m.servers.length ? ` (${m.servers.join(", ")})` : ""}`)
  console.log("  memory: snapshot-only in this PR — per-profile totals are not mirrored as individual memories (see design doc).")
  return targets
}

export const hubCommand = defineCommand({
  meta: { name: "hub", description: "Global hub under <home>/.unify/global: collect per-provider skills/MCP, then distribute on sync. Watcher is detection-only." },
  subCommands: {
    collect: defineCommand({
      meta: { name: "collect", description: "Mirror providers into the hub. Writes to the hub only, never to a provider." },
      async run() {
        const userHome = os.homedir()
        const home = unifyHome()
        await doCollect(userHome, home, hubRoot(home))
      },
    }),
    sync: defineCommand({
      meta: { name: "sync", description: "Collect into the hub, then distribute hub contents to every other provider (collisions skipped, secrets stripped)." },
      async run() {
        const userHome = os.homedir()
        const home = unifyHome()
        const hub = hubRoot(home)
        const targets = await doCollect(userHome, home, hub)
        const skillRows = await distributeSkills(hub, targets)
        for (const r of skillRows) console.log(`  distribute skills ${r.provider}: ${r.skill} ${r.action}`)
        const mcpRows = await distributeMcp(hub, userHome, mcpTargets(userHome))
        for (const r of mcpRows) console.log(`  distribute mcp ${r.provider}: ${r.server} ${r.action}`)
      },
    }),
    watch: defineCommand({
      meta: { name: "watch", description: "Watch the hub and report which provider subdir changed. Detection only — nothing is applied. Ctrl+C to stop." },
      async run() {
        const home = unifyHome()
        const hub = hubRoot(home)
        const targets = await skillTargets(os.homedir(), home)
        const providers = [...new Set(targets.map((t) => t.tool))]
        console.log(`watching hub: ${hub} (detection only, Ctrl+C to stop)`)
        const w = watchHub(hub, providers, (p) => {
          console.log(`hub changed: ${p || "(hub root)"} — run \`unify hub sync\` to apply`)
        })
        await new Promise(() => {})
        w.close()
      },
    }),
  },
  async run({ rawArgs }) {
    const first = rawArgs.find((a) => !a.startsWith("-"))
    if (first && ["collect", "sync", "watch"].includes(first)) return
    console.log("usage: unify hub <collect|sync|watch>")
  },
})
