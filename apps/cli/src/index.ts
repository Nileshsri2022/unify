import { defineCommand, runMain } from "citty"
import { CLI_VERSION, versionCommand } from "./commands/version"
import { initCommand } from "./commands/init"
import { statusCommand } from "./commands/status"
import { syncCommand } from "./commands/sync"
import { doctorCommand } from "./commands/doctor"
import { memoryCommand } from "./commands/memory"
import { profileCommand } from "./commands/profile"
import { uiCommand } from "./commands/ui"
import { discoverCommand } from "./commands/discover"
import { importSkillCommand } from "./commands/import-skill"
import { importMcpCommand } from "./commands/import-mcp"
import { importMemoryCommand } from "./commands/import-memory"
import { hubCommand } from "./commands/hub"

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
    profile: profileCommand,
    ui: uiCommand,
    discover: discoverCommand,
    "import-skill": importSkillCommand,
    "import-mcp": importMcpCommand,
    "import-memory": importMemoryCommand,
    hub: hubCommand,
  },
  async run({ rawArgs }) {
    // citty invokes the parent run after a subcommand completes — only show
    // help when no known subcommand was actually requested.
    const first = rawArgs.find((a) => !a.startsWith("-"))
    if (
      first &&
      ["init", "status", "sync", "doctor", "memory", "profile", "ui", "version", "discover", "import-skill", "import-mcp", "import-memory", "hub"].includes(first)
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
        "  profile   Show or switch the active profile (work / personal)",
        "  ui        Serve the dashboard + JSON API on one local port",
        "  discover  Read-only: list skills/MCPs found in every provider",
        "  import-skill  Import one discovered skill into the shared source",
        "  import-mcp  Import one MCP server, secrets stripped",
        "  import-memory  Import one memory from a file",
        "  hub  Global hub: collect/sync/watch per-provider skills+MCP",
        "  version   Print unify version",
        "",
        "Run 'unify --help' for details.",
      ].join("\n"),
    )
  },
})

runMain(main)
