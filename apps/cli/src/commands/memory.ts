import { defineCommand } from "citty"
import { unifyHome as coreUnifyHome } from "@unify/core"
import os from "node:os"
import path from "node:path"
import {
  AgentmemoryAdapter,
  agentmemoryCliPath,
  DEFAULT_AGENTMEMORY_BASE,
  ensureRunning,
} from "../adapters/agentmemory"
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

async function requireReady(userHome: string, unifyHome: string): Promise<AgentmemoryAdapter> {
  const a = adapterFor(userHome, unifyHome)
  const det = await a.detect()
  if (!det.installed) {
    console.error("agentmemory is not installed — run `unify init` first.")
    process.exitCode = 1
    return a
  }
  const base = process.env.AGENTMEMORY_URL || DEFAULT_AGENTMEMORY_BASE
  const logFile = path.join(unifyHome, "state", "agentmemory-server.log")
  console.log("ensuring memory server is running …")
  await ensureRunning({
    cliPath: agentmemoryCliPath(unifyHome),
    home: userHome,
    baseUrl: base,
    logFile,
  })
  return a
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
        const a = await requireReady(home, uHome)
        const concepts = (asString(args.concepts) ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
        const id = await a.save(text, concepts)
        console.log(`saved ${id}`)
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
        const a = await requireReady(home, uHome)
        const limit = asString(args.limit) ? Number(args.limit) : 10
        const results = await a.recall(query, limit)
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
