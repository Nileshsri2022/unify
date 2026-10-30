import { defineCommand } from "citty"
import { loadUnifyAt, type UnifiedStatus, unifyHome } from "@unify/core"
import os from "node:os"
import path from "node:path"
import { buildRegistry } from "../adapters/registry"
import type { SkillshareAdapter } from "../adapters/skillshare"
import type { AgentmemoryAdapter } from "../adapters/agentmemory"
import { renderStatus, readLastSync } from "./state-io"

export const statusCommand = defineCommand({
  meta: { name: "status", description: "Show backend health + target sync matrix" },
  args: {
    json: { type: "boolean", description: "Output raw UnifiedStatus JSON" },
  },
  async run({ args }) {
    const home = unifyHome()
    const userHome = os.homedir()
    const { config, errors } = await loadUnifyAt(path.join(home, "unify.yaml"))
    for (const e of errors) console.error(`config: ${e}`)
    if (errors.length > 0) process.exitCode = 1

    const reg = await buildRegistry(userHome, home)
    const skillshare = reg.get("skillshare") as SkillshareAdapter
    const agentmemory = reg.get("agentmemory") as AgentmemoryAdapter
    const [fs, am] = await Promise.all([skillshare.fullStatus(), agentmemory.fullStatus()])

    let memoryLine: string
    if (!am.backend.installed) {
      memoryLine = "not installed (fix: unify init)"
    } else if (am.backend.issues.some((i) => i.message.includes("not running"))) {
      memoryLine = "not running (fix: unify init)"
    } else {
      memoryLine = `${am.memory.total} entries (agentmemory v${am.backend.version ?? "?"})`
    }

    const status: UnifiedStatus = {
      profile: config.profile,
      backends: [fs.backend, am.backend],
      targets: fs.targets,
      memory: am.memory,
      generatedAt: new Date().toISOString(),
    }

    if (args.json) {
      console.log(JSON.stringify(status, null, 2))
    } else {
      console.log(renderStatus(status, await readLastSync(home), memoryLine))
    }
  },
})
