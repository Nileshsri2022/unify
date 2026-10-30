import path from "node:path"
import { isDir } from "@unify/core"

/**
 * skillshare's own default GLOBAL skills dir per target, extracted from
 * skillshare v0.28.0 internal/config/targets.yaml (pinned contract).
 * Note: codex/goose/zed share ~/.agents/skills (the universal dir) upstream.
 */
export const DEFAULT_SKILL_PATHS: Record<string, string> = {
  claude: "~/.claude/skills",
  codex: "~/.agents/skills",
  gemini: "~/.gemini/skills",
  cursor: "~/.cursor/skills",
  windsurf: "~/.codeium/windsurf/skills",
  opencode: "~/.config/opencode/skills",
  goose: "~/.agents/skills",
  copilot: "~/.copilot/skills",
  cline: "~/.cline/skills",
  zed: "~/.agents/skills",
  universal: "~/.agents/skills",
}

/**
 * Known host tools → directories (relative to home) whose presence means the
 * tool is installed. Names must match skillshare's target names.
 */
export const KNOWN_TOOLS: Record<string, string[]> = {
  claude: [".claude"],
  codex: [".codex"],
  gemini: [".gemini"],
  cursor: [".cursor"],
  windsurf: [".codeium/windsurf"],
  opencode: [".config/opencode"],
  goose: [".config/goose"],
  copilot: [".copilot"],
  cline: [".cline"],
  zed: [".config/zed"],
}

export async function detectInstalledTools(home: string): Promise<string[]> {
  const found: string[] = []
  for (const [name, rels] of Object.entries(KNOWN_TOOLS)) {
    for (const rel of rels) {
      if (await isDir(path.join(home, rel))) {
        found.push(name)
        break
      }
    }
  }
  return found
}
