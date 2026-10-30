import { defineCommand } from "citty"
import { loadUnifyAt, unifyHome } from "@unify/core"
import os from "node:os"
import path from "node:path"
import { buildRegistry } from "../adapters/registry"
import { renderSync, writeLastSync } from "./state-io"

export const syncCommand = defineCommand({
  meta: { name: "sync", description: "Sync backends to detected tools" },
  args: {
    dryRun: {
      type: "boolean",
      alias: "n",
      description: "Preview changes without applying",
    },
    target: {
      type: "string",
      description: "Only report changes for this target (sync itself is full)",
    },
  },
  async run({ args }) {
    const home = unifyHome()
    const userHome = os.homedir()
    const { errors } = await loadUnifyAt(path.join(home, "unify.yaml"))
    for (const e of errors) console.error(`config: ${e}`)
    if (errors.length > 0) process.exitCode = 1

    const reg = await buildRegistry(userHome, home)
    const adapter = reg.get("skillshare")!
    const wanted = args.target ? [args.target] : undefined
    const res = await adapter.sync({ dryRun: Boolean(args.dryRun), targets: wanted })

    const rows = res.changes.filter((c) => !wanted || wanted.includes(c.target))
    console.log(renderSync(res, rows))

    if (res.error) {
      process.exitCode = 1
    } else if (!res.dryRun) {
      await writeLastSync(home, {
        at: new Date().toISOString(),
        backend: res.backend,
        dryRun: false,
        changes: res.changes,
      })
    }
  },
})
