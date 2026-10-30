import {
  activeProfile,
  isFile,
  loadUnifyAt,
  switchProfile,
  type HealthIssue,
  type SyncOptions,
  type SyncResult,
  type UnifiedStatus,
  type UnifyConfig,
} from "@unify/core"
import path from "node:path"
import { buildRegistry } from "../adapters/registry"
import type { SkillshareAdapter } from "../adapters/skillshare"
import { AgentmemoryStartError, type AgentmemoryAdapter } from "../adapters/agentmemory"
import type { RecallResult } from "../adapters/agentmemory/client"
import { AGENTS_MD_GLAUE_ACTION, runAgentsMdGlue } from "../glue"
import { readLastSync, type LastSyncEntry } from "../commands/state-io"

/**
 * Memory startup failures are 503 (a dependency is unavailable), and the
 * message is reduced to its cause — the dashboard shows `error` verbatim, so a
 * 60-line engine dump would wreck the UI.
 */
function memoryUnavailable(e: unknown): Error {
  const message = e instanceof Error ? e.message : String(e)
  const cause = message.split("\n")[0]
  const hint =
    e instanceof AgentmemoryStartError && e.reason !== "start"
      ? " (run `unify init` to install the pinned memory engine)"
      : " (see ~/.unify/state/agentmemory-server.log)"
  return Object.assign(new Error(`${cause}${hint}`), { status: 503 })
}

export interface OrchestratorOptions {
  /** Override the agentmemory base URL (tests / AGENTMEMORY_URL). */
  agentmemoryBaseUrl?: string
  /** Extra env passed to the spawned memory server (tests). */
  serverEnv?: Record<string, string>
  /** Progress listener for memory startup (CLI prints it; API stays quiet). */
  log?: (line: string) => void
  /** Explicit skillshare binary path (tests: stub on PATH). */
  skillshareBinPath?: string
}

/**
 * Orchestrator: the single place that assembles status/doctor/profiles/sync
 * payloads. Shared by the CLI commands and the `unify ui` JSON API so both
 * always agree. Pure-ish: no console, no process.exit — throws or returns.
 */
export class Orchestrator {
  constructor(
    private userHome: string,
    private unifyHome: string,
    private opts: OrchestratorOptions = {},
  ) {}

  private async registry() {
    return buildRegistry(this.userHome, this.unifyHome, {
      agentmemoryBaseUrl: this.opts.agentmemoryBaseUrl ?? process.env.AGENTMEMORY_URL,
      agentmemoryServerEnv: this.opts.serverEnv,
      agentmemoryLog: this.opts.log,
      skillshareBinPath: this.opts.skillshareBinPath,
    })
  }

  async loadConfig(): Promise<{ config: UnifyConfig; errors: string[] }> {
    return loadUnifyAt(path.join(this.unifyHome, "unify.yaml"))
  }

  /** Status payload: backends + targets + memory + lastSync + memoryLine. */
  async status(): Promise<{
    status: UnifiedStatus
    lastSync: Awaited<ReturnType<typeof readLastSync>>
    memoryLine: string
  }> {
    const { config, errors } = await this.loadConfig()
    if (errors.length > 0) throw new Error(errors.join("; "))
    const reg = await this.registry()
    const sh = reg.get("skillshare") as SkillshareAdapter
    const am = reg.get("agentmemory") as AgentmemoryAdapter
    const [fs, amStatus] = await Promise.all([sh.fullStatus(), am.fullStatus()])

    let memoryLine: string
    if (!amStatus.backend.installed) {
      memoryLine = "not installed (fix: unify init)"
    } else if (amStatus.backend.issues.some((i) => i.message.includes("not running"))) {
      memoryLine = "not running (fix: unify init)"
    } else {
      memoryLine = `${amStatus.memory.total} entries (agentmemory v${amStatus.backend.version ?? "?"}, profile: ${config.profile})`
    }

    const status: UnifiedStatus = {
      profile: config.profile,
      backends: [fs.backend, amStatus.backend],
      targets: fs.targets,
      memory: amStatus.memory,
      generatedAt: new Date().toISOString(),
    }
    return { status, lastSync: await readLastSync(this.unifyHome), memoryLine }
  }

  /** Doctor payload: cross-backend issues (config, backends, lock, glue). */
  async doctor(): Promise<HealthIssue[]> {
    const { config, errors } = await this.loadConfig()
    const issues: HealthIssue[] = errors.map((e) => ({
      severity: "error",
      backend: "config",
      message: e,
    }))

    const reg = await this.registry()
    for (const a of reg.all()) issues.push(...(await a.doctor()))

    const lock = await this.readLock()
    if (lock?.skillshare) {
      const det = await (reg.get("skillshare") as SkillshareAdapter).detect()
      if (det.installed && det.version && lock.skillshare.version !== det.version) {
        issues.push({
          severity: "warn",
          backend: "skillshare",
          message: `lock ${lock.skillshare.version} != installed ${det.version}`,
          fix: "unify init",
        })
      }
    }

    if (config.glue["post-sync"].includes(AGENTS_MD_GLAUE_ACTION)) {
      const ap = activeProfile(config)
      const agentsMd = path.join(this.unifyHome, "AGENTS.md")
      if (ap.agentmemory.enabled && !(await isFile(agentsMd))) {
        issues.push({
          severity: "warn",
          backend: "glue",
          message: "AGENTS.md not found (inject-agents-md-into-memory has nothing to inject)",
          fix: `create ${agentsMd}`,
        })
      }
    }
    return issues
  }

  /** Profiles payload: active + each profile's backends. */
  async profiles(): Promise<{
    active: string
    profiles: {
      name: string
      active: boolean
      backends: {
        skillshare: { enabled: boolean; targets: string[] }
        agentmemory: { enabled: boolean; namespace: string }
      }
    }[]
  }> {
    const { config } = await this.loadConfig()
    const list = Object.entries(config.profiles).map(([name, p]) => {
      const ss = p.backends.skillshare ?? { enabled: true }
      const am = p.backends.agentmemory ?? { enabled: true, namespace: "shared" }
      return {
        name,
        active: config.profile === name,
        backends: {
          skillshare: { enabled: ss.enabled, targets: ss.targets ?? [] },
          agentmemory: { enabled: am.enabled, namespace: am.namespace },
        },
      }
    })
    return { active: config.profile, profiles: list }
  }

  async switchProfile(name: string): Promise<{ active: string }> {
    const res = await switchProfile(path.join(this.unifyHome, "unify.yaml"), name)
    if (!res.ok) throw Object.assign(new Error(res.error ?? "switch failed"), { status: 404 })
    return { active: name }
  }

  /**
   * Memory scope for save/recall: active profile's namespace by default,
   * or an existing profile's namespace when `profile` is given (dashboard
   * work/personal tabs). Agentmemory must be enabled for the ACTIVE profile.
   */
  private async memoryScope(profile?: string | null): Promise<{ profile: string; namespace: string }> {
    const { config, errors } = await this.loadConfig()
    if (errors.length > 0) throw Object.assign(new Error(errors.join("; ")), { status: 500 })
    const ap = activeProfile(config)
    if (!ap.agentmemory.enabled) {
      throw Object.assign(
        new Error(`agentmemory is disabled for profile "${config.profile}"`),
        { status: 503 },
      )
    }
    if (profile && profile !== config.profile) {
      const p = config.profiles[profile]
      if (!p) throw Object.assign(new Error(`unknown profile "${profile}"`), { status: 404 })
      return { profile, namespace: p.backends.agentmemory?.namespace ?? "shared" }
    }
    return { profile: config.profile, namespace: ap.agentmemory.namespace }
  }

  async memoryRecall(
    q: string,
    limit = 10,
    profile?: string | null,
  ): Promise<{ profile: string; namespace: string; results: RecallResult[] }> {
    const scope = await this.memoryScope(profile)
    const reg = await this.registry()
    const am = reg.get("agentmemory") as AgentmemoryAdapter
    if (!(await am.detect()).installed) {
      throw Object.assign(new Error("agentmemory is not installed — run `unify init`"), { status: 503 })
    }
    try {
      await am.ensureServer()
    } catch (e) {
      throw memoryUnavailable(e)
    }
    const results = await am.recall(q, limit, scope.namespace)
    return { profile: scope.profile, namespace: scope.namespace, results }
  }

  async memorySave(text: string, concepts: string[] = []): Promise<{ id: string; profile: string }> {
    const scope = await this.memoryScope(null)
    const reg = await this.registry()
    const am = reg.get("agentmemory") as AgentmemoryAdapter
    if (!(await am.detect()).installed) {
      throw Object.assign(new Error("agentmemory is not installed — run `unify init`"), { status: 503 })
    }
    try {
      await am.ensureServer()
    } catch (e) {
      throw memoryUnavailable(e)
    }
    const id = await am.save(text, concepts, scope.namespace)
    return { id, profile: scope.profile }
  }

  /** Sync skillshare (dry-run or apply) + post-sync glue. Returns result + glue lines. */
  async sync(opts: SyncOptions): Promise<{ result: SyncResult; glue: string[]; lastSync: LastSyncEntry | null }> {
    const { config } = await this.loadConfig()
    const reg = await this.registry()
    const sh = reg.get("skillshare") as SkillshareAdapter
    const result = await sh.sync(opts)
    const glue: string[] = []

    if (!result.dryRun && !result.error) {
      const entry: LastSyncEntry = {
        at: new Date().toISOString(),
        backend: result.backend,
        dryRun: false,
        changes: result.changes,
      }
      const { writeLastSync } = await import("../commands/state-io")
      await writeLastSync(this.unifyHome, entry)
      const log = (line: string) => glue.push(line)
      await runAgentsMdGlue({
        config,
        userHome: this.userHome,
        unifyHome: this.unifyHome,
        adapter: reg.get("agentmemory") as AgentmemoryAdapter,
        log,
      })
      return { result, glue, lastSync: entry }
    }
    return { result, glue, lastSync: null }
  }

  /** Hub collect (hub-only writes) — same service as CLI `hub collect`. */
  async hubCollect() {
    const { hubCollect } = await import("../global-hub/service")
    return hubCollect(this.userHome, this.unifyHome)
  }

  /** Hub sync (collect, then distribute, collisions skipped) — same as CLI `hub sync`. */
  async hubSync() {
    const { hubSync } = await import("../global-hub/service")
    return hubSync(this.userHome, this.unifyHome)
  }

  /** Last saved hub result, or null if collect has never run. */
  async hubStatus() {
    const { readHubStatus } = await import("../global-hub/service")
    const { hubRoot } = await import("../global-hub")
    return readHubStatus(hubRoot(this.unifyHome))
  }

  /**
   * Sync Everything (dashboard primary action): hubSync, then
   * skillshare sync apply. A skillshare failure must not blank
   * the hub result, so it is returned as skillshareError.
   */
  async syncEverything() {
    const hub = await this.hubSync()
    try {
      const skillshare = await this.sync({ dryRun: false })
      return { hub, skillshare }
    } catch (e) {
      return { hub, skillshareError: e instanceof Error ? e.message : String(e) }
    }
  }

  private async readLock() {
    const { readLock } = await import("../commands/state-io")
    return readLock(this.unifyHome)
  }
}
