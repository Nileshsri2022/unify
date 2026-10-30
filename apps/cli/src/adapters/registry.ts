import type { BackendAdapter } from "@unify/core"
import type { Runner } from "./runner"
import { realRunner } from "./runner"
import { resolveSkillshareBinary, SkillshareAdapter } from "./skillshare"
import { AgentmemoryAdapter, agentmemoryCliPath, DEFAULT_AGENTMEMORY_BASE } from "./agentmemory"

export class AdapterRegistry {
  private map = new Map<string, BackendAdapter>()

  register(a: BackendAdapter): this {
    this.map.set(a.id, a)
    return this
  }

  get(id: string): BackendAdapter | undefined {
    return this.map.get(id)
  }

  all(): BackendAdapter[] {
    return [...this.map.values()]
  }
}

export interface BuildRegistryOptions {
  /** Inject a skillshare runner (tests). Defaults to the resolved binary. */
  skillshareRunner?: Runner
  skillshareBinPath?: string
  /** Agentmemory base URL (tests / AGENTMEMORY_URL). */
  agentmemoryBaseUrl?: string
  agentmemoryRunner?: Runner
  agentmemoryNodeRunner?: Runner
  agentmemoryNpmRunner?: Runner
  /** Extra env for the spawned memory server (tests: STUB_PORT etc.). */
  agentmemoryServerEnv?: Record<string, string>
  /** Progress listener for agentmemory startup / engine provisioning. */
  agentmemoryLog?: (line: string) => void
}

/**
 * Build the registry of enabled backends (skillshare + agentmemory).
 * `userHome` is the OS home; `unifyHome` is the ~/.unify state dir.
 */
export async function buildRegistry(
  userHome: string,
  unifyHome: string,
  opts: BuildRegistryOptions = {},
): Promise<AdapterRegistry> {
  const reg = new AdapterRegistry()

  const bin = opts.skillshareBinPath ?? (await resolveSkillshareBinary(unifyHome))
  // Resolve per call, not once: `unify init` installs the binary *after* the
  // registry is built, and a long-running `unify ui` should pick up a backend
  // installed while it is running instead of reporting "not installed" forever.
  const shRunner: Runner =
    opts.skillshareRunner ??
    (async (args) => realRunner(await resolveSkillshareBinary(unifyHome, opts.skillshareBinPath))(args))
  reg.register(
    new SkillshareAdapter({
      runner: shRunner,
      home: userHome,
      unifyHome,
      binPath: bin === "skillshare" ? undefined : bin,
    }),
  )

  reg.register(
    new AgentmemoryAdapter({
      home: userHome,
      unifyHome,
      baseUrl: opts.agentmemoryBaseUrl ?? (process.env.AGENTMEMORY_URL || DEFAULT_AGENTMEMORY_BASE),
      runner: opts.agentmemoryRunner ?? realRunner(agentmemoryCliPath(unifyHome)),
      nodeRunner: opts.agentmemoryNodeRunner,
      npmRunner: opts.agentmemoryNpmRunner,
      serverEnv: opts.agentmemoryServerEnv,
      log: opts.agentmemoryLog,
    }),
  )

  return reg
}
