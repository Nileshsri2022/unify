import { defineCommand } from "citty"
import {
  activeProfile,
  loadUnifyAt,
  unifyHome as coreUnifyHome,
} from "@unify/core"
import os from "node:os"
import path from "node:path"
import {
  AgentmemoryAdapter,
  agentmemoryCliPath,
  DEFAULT_AGENTMEMORY_BASE,
  engineInstallPath,
} from "../adapters/agentmemory"
import { memoryStartHints } from "./init"
import { realRunner } from "../adapters/runner"

/** Narrow citty's loose arg union down to string (or null). */
function asString(v: unknown): string | null {
  return typeof v === "string" ? v : null
}

function adapterFor(userHome: string, unifyHome: string): AgentmemoryAdapter {
  const cli = agentmemoryCliPath(unifyHome)
  return new AgentmemoryAdapter({
    home: userHome,
    unifyHome,
    baseUrl: process.env.AGENTMEMORY_URL || DEFAULT_AGENTMEMORY_BASE,
    runner: realRunner(cli),
  })
}

async function requireReady(
  userHome: string,
  unifyHome: string,
): Promise<AgentmemoryAdapter | null> {
  const a = adapterFor(userHome, unifyHome)
  const det = await a.detect()
  if (!det.installed) {
    console.error("agentmemory is not installed — run `unify init` first.")
    process.exitCode = 1
    return null
  }
  console.log("ensuring memory server is running …")
  // Single code path for startup (engine provisioning included) — this is what
  // `unify init`, `unify ui` and `unify sync` glue use too.
  try {
    await a.ensureServer()
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error(`unify memory: ${message.split("\n")[0]}`)
    for (const line of memoryStartHints(message, engineInstallPath(userHome))) console.error(line)
    process.exitCode = 1
    return null
  }
  return a
}

/**
 * Resolve the active profile's memory scope (profile namespace = agentId).
 * Returns null (and sets exit code 1) when agentmemory is disabled for the
 * profile, so callers can bail cleanly without an unhandled rejection.
 */
async function profileScope(
  unifyHome: string,
): Promise<{ profile: string; namespace: string } | null> {
  const { config, errors } = await loadUnifyAt(path.join(unifyHome, "unify.yaml"))
  for (const e of errors) console.error(`config: ${e}`)
  const ap = activeProfile(config)
  if (!ap.agentmemory.enabled) {
    console.error(
      `agentmemory is disabled for profile "${config.profile}" (fix: set profiles.${config.profile}.backends.agentmemory.enabled in unify.yaml)`,
    )
    process.exitCode = 1
    return null
  }
  return { profile: config.profile, namespace: ap.agentmemory.namespace }
}

export const memoryCommand = defineCommand({
  meta: { name: "memory", description: "Save / recall persistent memory (agentmemory)" },
  subCommands: {
    save: defineCommand({
      meta: { name: "save", description: "Save a memory: unify memory save <text> [--concepts a,b]" },
      args: {
        text: { type: "positional", description: "Text to remember" },
        concepts: { type: "string", description: "Comma-separated concepts" },
      },
      async run({ args }) {
        const home = os.homedir()
        const uHome = coreUnifyHome()
        const text = asString(args.text)
        if (!text) {
          console.error("usage: unify memory save <text> [--concepts a,b]")
          process.exitCode = 1
          return
        }
        const scope = await profileScope(uHome)
        if (!scope) return
        const a = await requireReady(home, uHome)
        if (!a) return
        const concepts = (asString(args.concepts) ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
        const id = await a.save(text, concepts, scope.namespace)
        console.log(`saved ${id} [profile: ${scope.profile}]`)
      },
    }),
    recall: defineCommand({
      meta: { name: "recall", description: "Search memory: unify memory recall <query> [--limit n]" },
      args: {
        query: { type: "positional", description: "Search query" },
        limit: { type: "string", description: "Max results (default 10)" },
      },
      async run({ args }) {
        const home = os.homedir()
        const uHome = coreUnifyHome()
        const query = asString(args.query)
        if (!query) {
          console.error("usage: unify memory recall <query> [--limit n]")
          process.exitCode = 1
          return
        }
        const scope = await profileScope(uHome)
        if (!scope) return
        const a = await requireReady(home, uHome)
        if (!a) return
        const limit = asString(args.limit) ? Number(args.limit) : 10
        const results = await a.recall(query, limit, scope.namespace)
        if (results.length === 0) {
          console.log("no memories matched")
          return
        }
        for (const r of results) {
          console.log(`${r.obsId}  ${r.score.toFixed(2)}  ${r.title}`)
        }
      },
    }),
  },
  async run({ rawArgs }) {
    // citty invokes the parent run after a subcommand completes — only show
    // usage when no subcommand was requested.
    const first = rawArgs.find((a) => !a.startsWith("-"))
    if (first && ["save", "recall"].includes(first)) return
    console.log("usage: unify memory <save|recall> …  (see unify memory save --help)")
  },
})
