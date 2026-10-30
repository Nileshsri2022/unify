// Parsers for skillshare CLI output. These encode the pinned contract for
// skillshare v0.28.0 — fixtures in testdata/skillshare/0.28.0/ are the
// regression net (see M1-10).

export interface ParsedVersion {
  version: string
}

/** `skillshare --version` → "skillshare v0.28.0" */
export function parseVersion(stdout: string): ParsedVersion {
  const m = stdout.match(/skillshare\s+v?(\d+\.\d+\.\d+)/)
  if (!m) throw new Error(`unrecognized version output: ${stdout.trim()}`)
  return { version: m[1] }
}

export interface ParsedTarget {
  name: string
  skillsPath: string
  agentsPath?: string
}

/**
 * `skillshare target list` → blocks like:
 *   claude
 *     Skills    ~/.claude/skills  merge · flat · merged · 1 shared
 *     Agents    ~/.claude/agents  merge · no source agents yet
 *
 *   3 targets
 */
export function parseTargetList(stdout: string): ParsedTarget[] {
  const targets: ParsedTarget[] = []
  let current: ParsedTarget | null = null

  for (const raw of stdout.split("\n")) {
    const line = raw.replace(/\r$/, "")
    if (line.trim() === "") {
      current = null
      continue
    }
    if (/^\d+ targets?$/.test(line.trim())) {
      continue
    }
    if (!line.startsWith(" ") && !line.startsWith("\t")) {
      // target name line
      current = { name: line.trim(), skillsPath: "" }
      targets.push(current)
      continue
    }
    if (!current) continue
    const trimmed = line.trim()
    const skills = trimmed.match(/^Skills\s+(\S+)/)
    if (skills) {
      current.skillsPath = skills[1]
      continue
    }
    const agents = trimmed.match(/^Agents\s+(\S+)/)
    if (agents) {
      current.agentsPath = agents[1]
    }
  }
  return targets
}

export interface ParsedSync {
  dryRun: boolean
  targets: number
  details: {
    name: string
    mode: string
    linked: number
    updated: number
    pruned: number
  }[]
}

/** `skillshare sync [--dry-run] --json` */
export function parseSyncJson(stdout: string): ParsedSync {
  const d = JSON.parse(stdout) as Record<string, unknown>
  return {
    dryRun: Boolean(d.dry_run),
    targets: Number(d.targets ?? 0),
    details: (
      (d.details as Array<Record<string, unknown>>) ?? []
    ).map((x) => ({
      name: String(x.name),
      mode: String(x.mode ?? ""),
      linked: Number(x.linked ?? 0),
      updated: Number(x.updated ?? 0),
      pruned: Number(x.pruned ?? 0),
    })),
  }
}

/** `skillshare list --json` → skill names in the source. */
export function parseSkillList(stdout: string): string[] {
  const arr = JSON.parse(stdout) as Array<{ name: string; kind: string }>
  return arr.filter((s) => s.kind === "skill").map((s) => s.name)
}
