import { defineCommand } from "citty"
import { expandTilde } from "@unify/core"
import os from "node:os"
import path from "node:path"
import { importSkill } from "../discovery/import"
import { DEFAULT_SKILL_PATHS } from "../adapters/skillshare"

export const importSkillCommand = defineCommand({
  meta: {
    name: "import-skill",
    description: "Copy one discovered skill into the skillshare source, so the next `unify sync` distributes it to all providers. The original is left untouched.",
  },
  args: {
    name: { type: "positional", description: "Skill folder name, e.g. my-skill", required: true },
    from: { type: "string", description: "Provider the skill was found in, e.g. claude", required: true },
  },
  async run({ args }) {
    const name = args.name as string
    const from = args.from as string
    const rel = DEFAULT_SKILL_PATHS[from]
    if (!rel) {
      console.error(`unknown provider "${from}" — no verified default skills path. Run \`unify discover\` to see known providers.`)
      process.exitCode = 1
      return
    }
    const userHome = os.homedir()
    const fromDir = expandTilde(rel, userHome)
    const sourceDir = path.join(userHome, ".config", "skillshare", "skills")
    try {
      const dest = await importSkill({ name, fromDir, sourceDir })
      console.log(`imported ${name} from ${from} -> ${dest}`)
      console.log(`run \`unify sync\` to distribute it to all providers.`)
    } catch (e) {
      console.error(`import failed: ${e instanceof Error ? e.message : String(e)}`)
      process.exitCode = 1
    }
  },
})
