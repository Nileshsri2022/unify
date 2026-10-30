import { activeProfile, type UnifyConfig } from "@unify/core"
import path from "node:path"
import type { AgentmemoryAdapter } from "../adapters/agentmemory"
import { AGENTS_MD_GLAUE_ACTION, injectAgentsMdIntoMemory } from "./agentsMd"

export { AGENTS_MD_GLAUE_ACTION, injectAgentsMdIntoMemory } from "./agentsMd"
export type { AgentsMdGlueDeps, AgentsMdGlueResult } from "./agentsMd"

/** Default template written by `unify init` when ~/.unify/AGENTS.md is missing. */
export const AGENTS_MD_TEMPLATE = `# AGENTS.md — canonical agent instructions (managed by unify)

This file is injected into agentmemory after every successful \`unify sync\`
(glue action: \`inject-agents-md-into-memory\`). Edit it to change the rules
your agents recall; find it with \`unify memory recall "AGENTS.md snapshot"\`.

## Rules
- (add your standing instructions here)
`

export interface PostSyncGlueDeps {
  config: UnifyConfig
  userHome: string
  unifyHome: string
  adapter: AgentmemoryAdapter
  log?: (line: string) => void
}

/**
 * Post-sync glue: keep a fresh, per-profile AGENTS.md snapshot in agentmemory.
 *
 * Never fails the sync — every failure path logs a `glue: skipped/failed …`
 * line and returns. Gated on `glue.post-sync` containing the action id and
 * the active profile enabling agentmemory.
 */
export async function runAgentsMdGlue(d: PostSyncGlueDeps): Promise<void> {
  const { config, unifyHome, adapter } = d
  const log = d.log ?? ((line: string) => console.log(line))

  if (!config.glue["post-sync"].includes(AGENTS_MD_GLAUE_ACTION)) return
  const ap = activeProfile(config)
  if (!ap.agentmemory.enabled) return

  const det = await adapter.detect()
  if (!det.installed) {
    log("glue: skipped — agentmemory not installed (fix: unify init)")
    return
  }

  try {
    await adapter.ensureServer()
  } catch {
    log("glue: skipped — memory server not reachable (fix: unify init)")
    return
  }

  let client
  try {
    client = await adapter.client()
    const r = await injectAgentsMdIntoMemory({
      unifyHome,
      profileName: config.profile,
      namespace: ap.agentmemory.namespace,
      client,
    })
    if (r.injected) {
      log(`glue: AGENTS.md snapshot → memory (profile: ${config.profile}, hash ${r.hash})`)
    } else if (r.reason === "up-to-date") {
      log(`glue: AGENTS.md snapshot up to date (hash ${r.hash})`)
    } else {
      log(`glue: skipped — AGENTS.md not found (fix: create ${path.join(unifyHome, "AGENTS.md")})`)
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    log(`glue: inject-agents-md-into-memory failed: ${msg} (sync completed — run unify doctor)`)
  }
}
