import { defineCommand } from "citty"
import {
  activeProfile,
  loadUnifyAt,
  switchProfile,
  type UnifyConfig,
  unifyHome as coreUnifyHome,
} from "@unify/core"
import path from "node:path"

function asString(v: unknown): string | null {
  return typeof v === "string" ? v : null
}

/** Backend flip summary lines for the given active profile name. */
function flipLines(config: UnifyConfig, profileName: string): string[] {
  const ap = activeProfile(config)
  const targets = ap.skillshare.targets?.length
    ? ap.skillshare.targets.join(", ")
    : "(none)"
  return [
    `  skillshare targets: ${targets}${ap.skillshare.enabled ? "" : "  (disabled)"}`,
    `  agentmemory:        ${ap.agentmemory.enabled ? "enabled" : "disabled"}, namespace ${ap.agentmemory.namespace}`,
  ]
}

export const profileCommand = defineCommand({
  meta: {
    name: "profile",
    description: "Show or switch the active profile (work / personal / …)",
  },
  args: {
    name: { type: "positional", required: false, description: "Profile to switch to" },
  },
  async run({ args }) {
    const uHome = coreUnifyHome()
    const file = path.join(uHome, "unify.yaml")
    const name = asString(args.name)

    if (!name) {
      // show current
      const { config, errors } = await loadUnifyAt(file)
      for (const e of errors) console.error(`config: ${e}`)
      if (errors.length > 0) process.exitCode = 1
      console.log(
        ["active profile: " + config.profile, ...flipLines(config, config.profile)].join("\n"),
      )
      return
    }

    const before = await loadUnifyAt(file)
    const res = await switchProfile(file, name)
    if (!res.ok) {
      console.error(res.error)
      process.exitCode = 1
      return
    }
    console.log(
      [
        `profile switched: ${before.config.profile} → ${name}`,
        ...flipLines(res.config!, name),
      ].join("\n"),
    )
  },
})
