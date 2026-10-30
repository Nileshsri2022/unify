import { defineCommand } from "citty"
import { loadUnifyAt, type HealthIssue, unifyHome } from "@unify/core"
import os from "node:os"
import path from "node:path"
import { buildRegistry } from "../adapters/registry"
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

    console.log(renderDoctor(issues))
    if (issues.some((i) => i.severity === "error")) process.exitCode = 1
  },
})
