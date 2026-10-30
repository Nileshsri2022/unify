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
   * Ensure the memory server is running: probe first, and if down, auto-start
   * the pinned CLI (detached, log under state/). Throws if it cannot be
   * brought up within the ready timeout.
   */
  async ensureServer(): Promise<void> {
    if (await probe(this.base)) return
    await ensureRunning({
      cliPath: agentmemoryCliPath(this.d.unifyHome),
      entryPath: agentmemoryEntryPath(this.d.unifyHome),
      home: this.d.home,
      baseUrl: this.base,
      logFile: path.join(this.d.unifyHome, "state", "agentmemory-server.log"),
      env: this.d.serverEnv,
    })
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
      issues.push({
        severity: "warn",
        backend: this.id,
        message: "memory server not running",
        fix: "unify init",
      })
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
export { RestMemoryClient, ServerDownError, AuthError } from "./client"
export type { MemoryClient, RecallResult } from "./client"
