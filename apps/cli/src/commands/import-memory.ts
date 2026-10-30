import { defineCommand } from "citty"
import { createInterface } from "node:readline/promises"
import { readFile } from "node:fs/promises"
import os from "node:os"
import { unifyHome as coreUnifyHome } from "@unify/core"
import { validateMemoryText } from "../discovery/mcp-import"
import { profileScope, requireReady } from "./memory"

async function confirm(prompt: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const a = (await rl.question(prompt)).trim().toLowerCase()
  rl.close()
  return a === "y" || a === "yes"
}

export const importMemoryCommand = defineCommand({
  meta: {
    name: "import-memory",
    description: "Import ONE memory from a text file into the active profile's agentmemory namespace, with a preview and confirmation. This is not an automatic conversion of another tool's internal memory store.",
  },
  args: {
    file: { type: "string", description: "Text file containing the memory to import", required: true },
    concepts: { type: "string", description: "Comma-separated concepts" },
    yes: { type: "boolean", description: "Skip the confirmation prompt" },
  },
  async run({ args }) {
    const file = args.file as string
    let raw: string
    try {
      raw = await readFile(file, "utf-8")
    } catch (e) {
      console.error(`import-memory failed: cannot read ${file}: ${e instanceof Error ? e.message : String(e)}`)
      process.exitCode = 1
      return
    }
    let text: string
    try {
      text = validateMemoryText(raw)
    } catch (e) {
      console.error(`import-memory failed: ${e instanceof Error ? e.message : String(e)}`)
      process.exitCode = 1
      return
    }
    console.log(`Importing one memory (${text.length} chars) — preview:`)
    console.log(text.slice(0, 200) + (text.length > 200 ? "…" : ""))
    if (!args.yes && !(await confirm("Save this memory to the active profile? [y/N] "))) {
      console.log("Cancelled — nothing saved.")
      return
    }
    const home = os.homedir()
    const uHome = coreUnifyHome()
    const scope = await profileScope(uHome)
    if (!scope) return
    const a = await requireReady(home, uHome)
    if (!a) return
    const concepts = ((args.concepts as string) ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
    const id = await a.save(text, concepts, scope.namespace)
    console.log(`saved ${id} [profile: ${scope.profile}]`)
  },
})
