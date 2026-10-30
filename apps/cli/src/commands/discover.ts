import { defineCommand } from "citty"
import { expandTilde, unifyHome } from "@unify/core"
import os from "node:os"
import path from "node:path"
import { discoverMcp, discoverSkills } from "../discovery"
import { DEFAULT_SKILL_PATHS, parseTargetList, resolveSkillshareBinary } from "../adapters/skillshare"
import { realRunner } from "../adapters/runner"

async function managedTargets(userHome: string, home: string) {
  try {
    const bin = await resolveSkillshareBinary(home)
    const out = await realRunner(bin)(["target", "list"])
    if (out.code !== 0) return null
    const parsed = parseTargetList(out.stdout).filter((t) => t.skillsPath)
    if (parsed.length === 0) return null
    return parsed.map((t) => ({
      tool: t.name,
      skillsPath: expandTilde(t.skillsPath, userHome),
    }))
  } catch {
    return null
  }
}

export const discoverCommand = defineCommand({
  meta: {
    name: "discover",
    description: "Read-only: list skills, plugins (where known) and MCP servers found in every provider's default location. Makes no changes.",
  },
  args: {
    json: { type: "boolean", description: "Output JSON instead of a table" },
  },
  async run({ args }) {
    const userHome = os.homedir()
    const home = unifyHome()
    const targets =
      (await managedTargets(userHome, home)) ??
      Object.entries(DEFAULT_SKILL_PATHS).map(([tool, p]) => ({
        tool,
        skillsPath: expandTilde(p, userHome),
      }))
    const sourceDir = path.join(userHome, ".config", "skillshare", "skills")
    // Source skills are listed by the same rule as skillshare's own status.
    let sourceSkills: string[] = []
    try {
      const { readdir } = await import("node:fs/promises")
      const dirents = await readdir(sourceDir, { withFileTypes: true })
      sourceSkills = dirents.filter((e) => e.isDirectory()).map((e) => e.name)
    } catch {
      sourceSkills = []
    }
    const [skills, mcp] = await Promise.all([
      discoverSkills(targets, sourceSkills),
      discoverMcp(userHome),
    ])
    const result = { skills, mcp, note: "Plugins: no verified per-tool plugin location is mapped yet — no plugin path is guessed." }
    if (args.json) {
      console.log(JSON.stringify(result, null, 2))
      return
    }
    console.log("Skills found (read-only, nothing changed):")
    for (const row of skills) {
      if (row.state === "missing") {
        console.log(`  ${row.tool}: (skills folder missing)`)
        continue
      }
      if (row.skills.length === 0) {
        console.log(`  ${row.tool}: (no skills)`)
        continue
      }
      for (const s of row.skills) {
        console.log(`  ${row.tool}: ${s.name}${s.alreadyShared ? " (already shared)" : " — import with: unify import-skill " + s.name + " --from " + row.tool}`)
      }
    }
    console.log("\nMCP servers found (names only, secrets never shown):")
    for (const f of mcp) {
      if (f.state === "missing") continue
      if (f.state === "unparsable") {
        console.log(`  ${f.tool}: config unparsable at ${f.configPath}`)
        continue
      }
      for (const s of f.servers) console.log(`  ${f.tool}: ${s}${f.hasSecrets ? " (has secrets — re-enter on import, never auto-copied)" : ""}`)
    }
    console.log(`\n${result.note}`)
  },
})
