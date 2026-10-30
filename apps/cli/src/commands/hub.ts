import { defineCommand } from "citty"
import { unifyHome } from "@unify/core"
import os from "node:os"
import { hubRoot } from "../global-hub"
import { hubCollect, hubSync, skillTargets, type HubCollectResult } from "../global-hub/service"
import { watchHub } from "../global-hub/watch"

// Thin printer over global-hub/service.ts — the service is shared
// with the dashboard API, so CLI and UI can never disagree.
function printCollect(result: HubCollectResult) {
  console.log(`hub: ${result.hub}`)
  for (const s of result.skills) console.log(`  skills ${s.provider}: ${s.state}${s.skills.length ? ` (${s.skills.join(", ")})` : ""}`)
  for (const m of result.mcp) console.log(`  mcp ${m.provider}: ${m.state}${m.servers.length ? ` (${m.servers.join(", ")})` : ""}`)
  console.log("  memory: snapshot-only in this PR — per-profile totals are not mirrored as individual memories (see design doc).")
}

export const hubCommand = defineCommand({
  meta: { name: "hub", description: "Global hub under <home>/.unify/global: collect per-provider skills/MCP, then distribute on sync. Watcher is detection-only." },
  subCommands: {
    collect: defineCommand({
      meta: { name: "collect", description: "Mirror providers into the hub. Writes to the hub only, never to a provider." },
      async run() {
        printCollect(await hubCollect(os.homedir(), unifyHome()))
      },
    }),
    sync: defineCommand({
      meta: { name: "sync", description: "Collect into the hub, then distribute hub contents to every other provider (collisions skipped, secrets stripped)." },
      async run() {
        const { collect, distributeSkills, distributeMcp } = await hubSync(os.homedir(), unifyHome())
        printCollect(collect)
        for (const r of distributeSkills) console.log(`  distribute skills ${r.provider}: ${r.skill} ${r.action}`)
        for (const r of distributeMcp) console.log(`  distribute mcp ${r.provider}: ${r.server} ${r.action}`)
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
