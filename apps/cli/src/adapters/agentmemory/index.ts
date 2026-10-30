import {
  type BackendAdapter,
  type BackendManifest,
  type BackendStatus,
  type Detection,
  type HealthIssue,
  type MemorySummary,
  type SyncOptions,
  type SyncResult,
  isFile,
} from "@unify/core"
import { mkdir, readFile } from "node:fs/promises"
import path from "node:path"
import type { Runner } from "../runner"
import { realRunner } from "../runner"
import {
  AuthError,
  RestMemoryClient,
  ServerDownError,
  type MemoryClient,
  type RecallResult,
} from "./client"
import { ensureRunning, probe } from "./server"
import { agentmemoryArgv, agentmemoryEntryPath } from "./command"
import { EngineError, ensureEngine, engineInstallPath } from "./engine"

export const AGENTMEMORY_PINNED_VERSION = "0.9.31"
export const AGENTMEMORY_NPM_PACKAGE = "@agentmemory/agentmemory"
export const DEFAULT_AGENTMEMORY_BASE = "http://localhost:3111"

export function agentmemoryCliPath(unifyHome: string): string {
  return path.join(unifyHome, "backends", "agentmemory", "node_modules", ".bin", "agentmemory")
}

export function agentmemoryManifest(): BackendManifest {
  return {
    version: AGENTMEMORY_PINNED_VERSION,
    // npm-pinned by exact version; file hash not applicable (registry integrity)
    sha256: "",
    source: `npm:${AGENTMEMORY_NPM_PACKAGE}@${AGENTMEMORY_PINNED_VERSION}`,
  }
}

export interface AgentmemoryAdapterDeps {
  /** User home (agentmemory state lives under $HOME/.agentmemory). */
  home: string
  /** unify home (~/.unify) — backend installed under backends/agentmemory. */
  unifyHome: string
  baseUrl?: string
  /** Runner bound to the agentmemory bin (init/stop). */
  runner: Runner
  /** Runner for `node -v` checks (tests inject a fake). */
  nodeRunner?: Runner
  /** Runner for `npm install` (tests inject a fake). */
  npmRunner?: Runner
  /** Extra env for the spawned server supervisor (tests: STUB_PORT etc.). */
  serverEnv?: Record<string, string>
  /** Override for tests (defaults to live REST calls). */
  client?: MemoryClient
  /** Ready timeout for the supervisor (tests keep this short). */
  readyTimeoutMs?: number
  /** Progress listener for engine provisioning (defaults to silent). */
  log?: (line: string) => void
}

/** Startup failure with a machine-readable reason (init/doctor/dashboard use it). */
export class AgentmemoryStartError extends Error {
  constructor(
    readonly reason: "engine" | "engine-unsupported" | "start",
    message: string,
    opts?: { cause?: unknown },
  ) {
    super(message, opts)
    this.name = "AgentmemoryStartError"
  }
}

export interface AgentmemoryFullStatus {
  backend: BackendStatus
  memory: MemorySummary
}

function nodeMajor(stdout: string): number {
  const m = stdout.match(/v?(\d+)/)
  return m ? Number(m[1]) : 0
}

export class AgentmemoryAdapter implements BackendAdapter {
  readonly id = "agentmemory"

  constructor(private d: AgentmemoryAdapterDeps) {}

  private get base(): string {
    return this.d.baseUrl ?? DEFAULT_AGENTMEMORY_BASE
  }

  private get npm(): Runner {
    return this.d.npmRunner ?? realRunner("npm")
  }

  private get node(): Runner {
    return this.d.nodeRunner ?? realRunner("node")
  }

  /** Authenticated REST client (loads ~/.agentmemory/secret). */
  async client(): Promise<MemoryClient> {
    if (this.d.client) return this.d.client
    const secret = await this.loadSecret()
    return new RestMemoryClient({ baseUrl: this.base, secret })
  }

  /**
   * Ensure the memory server is running.
   *
   * Order matters: probe → (Windows only) provision iii-engine → start the
   * supervisor → if it failed because the engine is missing, provision and
   * retry once.
   *
   * Up-front provisioning is limited to Windows because agentmemory 0.9.31
   * *cannot* install its engine there (it shells out to curl/tar and gives up on
   * zip assets), which used to surface as a 180 s hang in `unify init`. On other
   * platforms agentmemory installs the engine itself, so unify only steps in
   * after a failure, and only when the binary is genuinely absent — a running
   * engine, a stub or a custom setup is left alone.
   *
   * UNIFY_SKIP_ENGINE_INSTALL=1 disables all of this.
   */
  async ensureServer(): Promise<void> {
    if (await probe(this.base)) return

    const allowProvision = process.env.UNIFY_SKIP_ENGINE_INSTALL !== "1"

    // Windows: always verify. ensureEngine() returns immediately when the
    // pinned binary is present and runs, and reinstalls when it is missing,
    // corrupt or an old copy from a previous attempt — a stale iii.exe must not
    // be trusted just because the file exists.
    if (allowProvision && process.platform === "win32") {
      await this.provisionEngine()
    }

    try {
      await this.startSupervisor()
    } catch (e) {
      const canRetry = allowProvision && !(await isFile(engineInstallPath(this.d.home)))
      if (!canRetry) {
        throw e instanceof AgentmemoryStartError
          ? e
          : new AgentmemoryStartError("start", e instanceof Error ? e.message : String(e), {
              cause: e,
            })
      }
      // the supervisor died because the engine is missing — install it and retry
      await this.provisionEngine()
      await this.startSupervisor()
    }
  }

  private async provisionEngine(): Promise<void> {
    try {
      const r = await ensureEngine({ home: this.d.home, log: (line) => this.d.log?.(line) })
      this.d.log?.(
        r.installed
          ? `iii-engine ${r.version ?? ""} installed (${r.path})`.trim()
          : `iii-engine present (${r.version ?? "?"}) — ${r.path}`,
      )
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e)
      throw new AgentmemoryStartError(
        e instanceof EngineError && e.code === "unsupported-platform" ? "engine-unsupported" : "engine",
        `iii-engine is required by agentmemory but could not be installed: ${detail}`,
        { cause: e },
      )
    }
  }

  private async startSupervisor(): Promise<void> {
    try {
      await ensureRunning({
        cliPath: agentmemoryCliPath(this.d.unifyHome),
        entryPath: agentmemoryEntryPath(this.d.unifyHome),
        home: this.d.home,
        baseUrl: this.base,
        logFile: path.join(this.d.unifyHome, "state", "agentmemory-server.log"),
        env: this.d.serverEnv,
        readyTimeoutMs: this.d.readyTimeoutMs,
      })
    } catch (e) {
      throw new AgentmemoryStartError("start", e instanceof Error ? e.message : String(e), {
        cause: e,
      })
    }
  }

  /** True when the engine binary agentmemory needs is present. */
  async engineInstalled(): Promise<boolean> {
    return isFile(engineInstallPath(this.d.home))
  }

  private async loadSecret(): Promise<string | undefined> {
    try {
      const t = await readFile(path.join(this.d.home, ".agentmemory", "secret"), "utf8")
      const s = t.trim()
      return s.length > 0 ? s : undefined
    } catch {
      return undefined
    }
  }

  private async packageVersion(): Promise<string | undefined> {
    try {
      const p = path.join(
        this.d.unifyHome,
        "backends",
        "agentmemory",
        "node_modules",
        AGENTMEMORY_NPM_PACKAGE,
        "package.json",
      )
      const doc = JSON.parse(await readFile(p, "utf8")) as { version?: string }
      return doc.version
    } catch {
      return undefined
    }
  }

  manifest(): BackendManifest {
    return agentmemoryManifest()
  }

  async detect(): Promise<Detection> {
    const cli = agentmemoryCliPath(this.d.unifyHome)
    if (!(await isFile(cli))) return { installed: false }
    let version = await this.packageVersion()
    try {
      const h = await (await this.client()).health()
      version = h.version
    } catch {
      /* server down or auth issue — package version stands */
    }
    return { installed: true, path: cli, version }
  }

  async status(): Promise<BackendStatus> {
    return (await this.fullStatus()).backend
  }

  async fullStatus(): Promise<AgentmemoryFullStatus> {
    const notInstalled: AgentmemoryFullStatus = {
      backend: {
        id: this.id,
        installed: false,
        healthy: false,
        issues: [{ severity: "error", backend: this.id, message: "agentmemory not installed", fix: "unify init" }],
      },
      memory: { namespaces: [], total: 0 },
    }
    if (!(await (await this.detect()).installed)) return notInstalled

    if (!(await probe(this.base))) {
      return {
        backend: {
          id: this.id,
          installed: true,
          version: await this.packageVersion(),
          pinnedVersion: AGENTMEMORY_PINNED_VERSION,
          healthy: false,
          issues: [
            {
              severity: "warn",
              backend: this.id,
              message: "memory server not running",
              fix: "unify init",
            },
          ],
        },
        memory: { namespaces: [], total: 0 },
      }
    }

    const c = await this.client()
    const [h, count] = await Promise.all([c.health(), c.memoryCount()])
    return {
      backend: {
        id: this.id,
        installed: true,
        version: h.version,
        pinnedVersion: AGENTMEMORY_PINNED_VERSION,
        healthy: h.status === "healthy",
        issues:
          h.status === "healthy"
            ? []
            : [{ severity: "warn", backend: this.id, message: `server health: ${h.status}`, fix: "unify doctor" }],
      },
      memory: { namespaces: [], total: count },
    }
  }

  /** Direct memory ops (beyond the BackendAdapter surface). */
  async save(
    content: string,
    concepts: string[] = [],
    agentId?: string,
  ): Promise<string> {
    return (await this.client()).save(content, concepts, agentId)
  }

  async recall(query: string, limit = 10, agentId?: string): Promise<RecallResult[]> {
    return (await this.client()).recall(query, limit, agentId)
  }

  async sync(options: SyncOptions): Promise<SyncResult> {
    if (!(await probe(this.base))) {
      return {
        backend: this.id,
        dryRun: options.dryRun,
        changes: [],
        error: "agentmemory server not running (fix: unify init)",
      }
    }
    const count = await (await this.client()).memoryCount()
    return {
      backend: this.id,
      dryRun: options.dryRun,
      changes: [
        {
          target: this.id,
          action: `${count} memories indexed (pull-based store — nothing to push)`,
        },
      ],
    }
  }

  async doctor(): Promise<HealthIssue[]> {
    const issues: HealthIssue[] = []
    const det = await this.detect()
    if (!det.installed) {
      return [{ severity: "error", backend: this.id, message: "agentmemory not installed", fix: "unify init" }]
    }
    const nv = await this.node(["-v"])
    if (nv.code !== 0 || nodeMajor(nv.stdout) < 20) {
      issues.push({
        severity: "error",
        backend: this.id,
        message: `node 20+ required for agentmemory (found: ${nv.stdout.trim() || "none"})`,
        fix: "install Node 20+",
      })
    }
    if (!(await probe(this.base))) {
      // Name the actual blocker: a missing iii-engine is a different fix from a
      // crashed supervisor, and "not running" alone sent users in circles.
      const engine = engineInstallPath(this.d.home)
      if (!(await isFile(engine))) {
        issues.push({
          severity: "error",
          backend: this.id,
          message: `memory server not running — iii-engine missing (${engine})`,
          fix: "unify init  (unify installs the pinned engine)",
        })
      } else {
        issues.push({
          severity: "warn",
          backend: this.id,
          message: "memory server not running",
          fix: "unify init   ·   log: ~/.unify/state/agentmemory-server.log",
        })
      }
      return issues
    }
    if (det.version && det.version !== AGENTMEMORY_PINNED_VERSION) {
      issues.push({
        severity: "warn",
        backend: this.id,
        message: `version ${det.version} != pinned ${AGENTMEMORY_PINNED_VERSION}`,
        fix: "unify init",
      })
    }
    try {
      const h = await (await this.client()).health()
      if (h.status !== "healthy") {
        issues.push({
          severity: "warn",
          backend: this.id,
          message: `server health: ${h.status}`,
          fix: "unify doctor",
        })
      }
    } catch (e) {
      if (e instanceof AuthError) {
        issues.push({
          severity: "warn",
          backend: this.id,
          message: "REST auth failed — secret missing or stale",
          fix: "agentmemory init (regenerate secret)",
        })
      } else if (e instanceof ServerDownError) {
        issues.push({
          severity: "warn",
          backend: this.id,
          message: "memory server went down during check",
          fix: "unify init",
        })
      }
    }
    return issues
  }

  /**
   * npm-install the pinned package under ~/.unify/backends/agentmemory and
   * run `agentmemory init` (writes ~/.agentmemory/.env if absent).
   */
  async install(manifest: BackendManifest): Promise<void> {
    const dir = path.join(this.d.unifyHome, "backends", "agentmemory")
    await mkdir(dir, { recursive: true })
    const r = await this.npm([
      "install",
      "--no-fund",
      "--no-audit",
      "--prefix",
      dir,
      `${AGENTMEMORY_NPM_PACKAGE}@${manifest.version}`,
    ])
    if (r.code !== 0) {
      throw new Error(`npm install agentmemory failed: ${(r.stderr || r.stdout).trim()}`)
    }
    if (!(await isFile(agentmemoryCliPath(this.d.unifyHome)))) {
      throw new Error("install completed but agentmemory bin is missing")
    }
    const init = await this.d.runner(["init"])
    if (init.code !== 0) {
      throw new Error(`agentmemory init failed: ${(init.stderr || init.stdout).trim()}`)
    }
  }
}

export { probe } from "./server"
export { ensureRunning, stop } from "./server"
export type { EnsureRunningOptions } from "./server"
export { agentmemoryArgv, agentmemoryEntryPath } from "./command"
export {
  III_PINNED_VERSION,
  III_RELEASE_SHA256,
  EngineError,
  ensureEngine,
  engineBinName,
  engineInstallPath,
  iiiAssetFor,
  iiiReleaseUrl,
  type EngineErrorCode,
  type EnsureEngineResult,
} from "./engine"
export { RestMemoryClient, ServerDownError, AuthError } from "./client"
export type { MemoryClient, RecallResult } from "./client"
