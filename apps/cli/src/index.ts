import { defineCommand, runMain } from "citty"
import { CLI_VERSION, versionCommand } from "./commands/version"
import { initCommand } from "./commands/init"
import { statusCommand } from "./commands/status"
import { syncCommand } from "./commands/sync"
import { doctorCommand } from "./commands/doctor"
import { memoryCommand } from "./commands/memory"

const main = defineCommand({
  meta: {
    name: "unify",
    version: CLI_VERSION,
    description: "One manager for your local AI coding-agent stack",
  },
  subCommands: {
    version: versionCommand,
    init: initCommand,
    status: statusCommand,
    sync: syncCommand,
    doctor: doctorCommand,
    memory: memoryCommand,
  },
  async run({ rawArgs }) {
    // citty invokes the parent run after a subcommand completes — only show
    // help when no known subcommand was actually requested.
    const first = rawArgs.find((a) => !a.startsWith("-"))
    if (
      first &&
      ["init", "status", "sync", "doctor", "memory", "version"].includes(first)
    )
      return
    console.log(
      [
        "unify — one manager for your local AI coding-agent stack",
        "",
        "Usage: unify <command> [options]",
        "Commands:",
        "  init      First-run setup (detect tools, install backends, first sync)",
        "  status    Show backend health + target sync matrix",
        "  sync      Sync backends to detected tools",
        "  doctor    Check backend health + config issues",
        "  memory    Save / recall persistent memory (agentmemory)",
        "  version   Print unify version",
        "",
        "Run 'unify --help' for details.",
      ].join("\n"),
    )
  },
})

runMain(main)
