import { readFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import path from "node:path"
import type { MemoryClient } from "../adapters/agentmemory/client"

/** DESIGN §5: the glue action id listed under `glue.post-sync`. */
export const AGENTS_MD_GLAUE_ACTION = "inject-agents-md-into-memory"

export interface AgentsMdGlueResult {
  injected: boolean
  /** First 12 hex of sha256(AGENTS.md). Empty when skipped. */
  hash: string
  /** "missing" | "up-to-date" | undefined when injected. */
  reason?: string
}

export interface AgentsMdGlueDeps {
  /** ~/.unify — where the canonical AGENTS.md lives. */
  unifyHome: string
  /** Active profile name (for the snapshot header). */
  profileName: string
  /** Profile namespace → agentId tag (per-profile isolation). */
  namespace: string
  /** Agentmemory client; server must be running (caller ensures). */
  client: MemoryClient
}

const MAX_SNAPSHOT_BYTES = 8000

/**
 * Keep one fresh AGENTS.md snapshot per profile in agentmemory.
 *
 * Idempotent: the snapshot carries a `[unify:hash=<sha256-12>]` marker in its
 * first line; a namespaced recall for the marker decides inject-vs-skip, so
 * repeated syncs don't pile up duplicates and edits produce new versions.
 */
export async function injectAgentsMdIntoMemory(
  d: AgentsMdGlueDeps,
): Promise<AgentsMdGlueResult> {
  let content: string
  try {
    content = await readFile(path.join(d.unifyHome, "AGENTS.md"), "utf8")
  } catch {
    return { injected: false, hash: "", reason: "missing" }
  }

  const hash = createHash("sha256").update(content).digest("hex").slice(0, 12)
  const marker = `[unify:hash=${hash}]`

  const existing = await d.client.recall(`AGENTS.md snapshot ${marker}`, 5, d.namespace)
  if (existing.some((h) => h.title.includes(marker))) {
    return { injected: false, hash, reason: "up-to-date" }
  }

  const body =
    content.length > MAX_SNAPSHOT_BYTES
      ? content.slice(0, MAX_SNAPSHOT_BYTES) + "\n… [truncated by unify]"
      : content
  const text = [`AGENTS.md snapshot ${marker}`, `profile: ${d.profileName}`, "", body].join("\n")

  await d.client.save(text, ["agents-md", "glue"], d.namespace)
  return { injected: true, hash }
}
