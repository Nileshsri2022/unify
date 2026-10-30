import { defineCommand } from "citty"
import { createInterface } from "node:readline/promises"
import os from "node:os"
import { importMcpServer, resolveJsonMcpConfig } from "../discovery/mcp-import"

async function confirm(prompt: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const a = (await rl.question(prompt)).trim().toLowerCase()
  rl.close()
  return a === "y" || a === "yes"
}

export const importMcpCommand = defineCommand({
  meta: {
    name: "import-mcp",
    description: "Import ONE MCP server from one provider to another, without its secrets. Secrets must be re-entered in the target tool. JSON configs only.",
  },
  args: {
    server: { type: "positional", description: "MCP server name, e.g. github", required: true },
    from: { type: "string", description: "Source provider, e.g. claude", required: true },
    to: { type: "string", description: "Target provider, e.g. cursor", required: true },
    yes: { type: "boolean", description: "Skip the confirmation prompt" },
  },
  async run({ args }) {
    const server = args.server as string
    const from = args.from as string
    const to = args.to as string
    const home = os.homedir()
    let fromPath: string
    let toPath: string
    try {
      fromPath = resolveJsonMcpConfig(home, from)
      toPath = resolveJsonMcpConfig(home, to)
    } catch (e) {
      console.error(`import-mcp failed: ${e instanceof Error ? e.message : String(e)}`)
      process.exitCode = 1
      return
    }
    console.log(`Importing MCP server "${server}" from ${from} (${fromPath}) to ${to} (${toPath}).`)
    console.log("Secrets (env, headers, tokens) will NOT be copied — re-enter them in the target tool.")
    if (!args.yes && !(await confirm("Import this one server? [y/N] "))) {
      console.log("Cancelled — nothing changed.")
      return
    }
    try {
      const r = await importMcpServer({ server, fromPath, toPath })
      console.log(`imported ${r.server} -> ${r.toPath}${r.hadSecrets ? " (source had secrets — they were stripped, re-enter them in the target tool)" : ""}`)
    } catch (e) {
      console.error(`import-mcp failed: ${e instanceof Error ? e.message : String(e)}`)
      process.exitCode = 1
    }
  },
})
