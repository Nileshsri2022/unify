import { defineCommand } from "citty"
import {
  activeProfile,
  isFile,
  loadUnifyAt,
  type HealthIssue,
  unifyHome,
} from "@unify/core"
import os from "node:os"
import path from "node:path"
import { buildRegistry } from "../adapters/registry"
import { AGENTS_MD_GLAUE_ACTION } from "../glue"
import { readLock, renderDoctor } from "./state-io"

export const doctorCommand = defineCommand({
  meta: { name: "doctor", description: "Check backend health + config issues" },
  async run() {
    const home = unifyHome()
    const userHome = os.homedir()
    const { config, errors } = await loadUnifyAt(path.join(home, "unify.yaml"))

    const issues: HealthIssue[] = errors.map((e) => ({
      severity: "error",
      backend: "config",
      message: e,
    }))

    const reg = await buildRegistry(userHome, home)
    for (const a of reg.all()) {
      issues.push(...(await a.doctor()))
    }

    // lock vs installed version (stale lock radar)
    const lock = await readLock(home)
    if (lock?.skillshare) {
      const det = await reg.get("skillshare")!.detect()
      if (det.installed && det.version && lock.skillshare.version !== det.version) {
        issues.push({
          severity: "warn",
          backend: "skillshare",
          message: `lock ${lock.skillshare.version} != installed ${det.version}`,
          fix: "unify init",
        })
      }
    }

    // glue radar: canonical AGENTS.md must exist when the glue action is on
    if (config.glue["post-sync"].includes(AGENTS_MD_GLAUE_ACTION)) {
      const ap = activeProfile(config)
      const agentsMd = path.join(home, "AGENTS.md")
      if (ap.agentmemory.enabled && !(await isFile(agentsMd))) {
        issues.push({
          severity: "warn",
          backend: "glue",
          message: "AGENTS.md not found (inject-agents-md-into-memory has nothing to inject)",
          fix: `create ${agentsMd}`,
        })
      }
    }

    console.log(renderDoctor(issues))
    if (issues.some((i) => i.severity === "error")) process.exitCode = 1
  },
})
