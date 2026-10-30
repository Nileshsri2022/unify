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

  const bin =
    opts.skillshareBinPath ?? (await resolveSkillshareBinary(unifyHome))
  const shRunner = opts.skillshareRunner ?? realRunner(bin)
  reg.register(
    new SkillshareAdapter({
      runner: shRunner,
      home: userHome,
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
    }),
  )

  return reg
}
