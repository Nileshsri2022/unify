import {
  type BackendAdapter,
  type BackendManifest,
  type BackendStatus,
  type Detection,
  type HealthIssue,
  type SyncOptions,
  type SyncResult,
  type TargetRow,
  expandTilde,
  isDir,
  isFile,
} from "@unify/core"
import path from "node:path"
import { createHash } from "node:crypto"
import { existsSync, statSync } from "node:fs"
import { mkdir, readdir, writeFile, chmod } from "node:fs/promises"
import type { Runner } from "../runner"
import { realRunner } from "../runner"
import { parseSyncJson, parseTargetList, parseVersion } from "./parse"
import { readMember } from "../archive"
import { SKILLSHARE_PINNED_VERSION } from "./manifest"
import { DEFAULT_SKILL_PATHS, KNOWN_TOOLS, detectInstalledTools } from "./tools"

export interface SkillshareAdapterDeps {
  /** Pre-bound runner for the skillshare binary to use (tests inject a fake). */
  runner: Runner
  /** User home — tool detection, tilde expansion, state dirs. */
  home: string
  /** unify state dir (default `<home>/.unify`) — backends and cache live here. */
  unifyHome?: string
  /** Display path for detection results; defaults to resolved binary. */
  binPath?: string
  /** Override source skills dir (default ~/.config/skillshare/skills). */
  sourceDir?: string
  /**
   * Env/platform used to locate skillshare's global config. Injectable so
   * tests are not at the mercy of the ambient $XDG_CONFIG_HOME (GitHub
   * runners set it; that made the config-discovery tests fail only on CI)
   * and so win32 config paths can be exercised from any host.
   */
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
}

export interface SkillshareFullStatus {
  backend: BackendStatus
  targets: TargetRow[]
  skills: string[]
}

/**
 * Where skillshare keeps its global config. XDG on unix, %APPDATA% on Windows
 * (verified from its CLI output: "global config:
 * C:\\Users\\<user>\\AppData\\Roaming\\skillshare\\config.yaml").
 */
export function skillshareConfigPaths(
  home: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string[] {
  const paths: string[] = []
  if (platform === "win32") {
    const appData = env.APPDATA ?? path.join(home, "AppData", "Roaming")
    paths.push(path.join(appData, "skillshare", "config.yaml"))
  }
  const xdg = env.XDG_CONFIG_HOME ?? path.join(home, ".config")
  paths.push(path.join(xdg, "skillshare", "config.yaml"))
  return [...new Set(paths)]
}

/** First non-empty line — enough for a one-line error, never a stack. */
function firstLine(text: string): string {
  return text.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? ""
}

/** Release asset member name — Windows ships `skillshare.exe`. */
export function skillshareBinName(platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? "skillshare.exe" : "skillshare"
}

/**
 * Resolve which skillshare binary to run: explicit > env > managed > PATH.
 *
 * Both member names are probed in the managed dir regardless of the current
 * platform (a WSL/Windows dual setup can hold either), but the native name is
 * tried first so `unify init` finds what it just installed.
 */
export async function resolveSkillshareBinary(
  unifyHome: string,
  explicit?: string,
  platform: NodeJS.Platform = process.platform,
): Promise<string> {
  const managedDir = path.join(unifyHome, "backends", "skillshare")
  const native = skillshareBinName(platform)
  const other = skillshareBinName(platform === "win32" ? "linux" : "win32")
  const candidates = [
    explicit,
    process.env.SKILLSHARE_BIN,
    path.join(managedDir, native),
    path.join(managedDir, other),
  ].filter((x): x is string => Boolean(x))
  for (const c of candidates) {
    if (await isFile(c)) return c
  }
  return "skillshare"
}

export class SkillshareAdapter implements BackendAdapter {
  readonly id = "skillshare"

  constructor(private d: SkillshareAdapterDeps) {}

  /** unify state dir; honours `$UNIFY_HOME` when injected by the registry. */
  private get stateHome(): string {
    return this.d.unifyHome ?? path.join(this.d.home, ".unify")
  }

  private get source(): string {
    return this.d.sourceDir ?? path.join(this.d.home, ".config", "skillshare", "skills")
  }

  async detect(): Promise<Detection> {
    const r = await this.d.runner(["--version"])
    if (r.code !== 0) return { installed: false }
    const v = parseVersion(r.stdout)
    return {
      installed: true,
      version: v.version,
      path: this.d.binPath ?? (await resolveSkillshareBinary(this.stateHome)),
    }
  }

  async status(): Promise<BackendStatus> {
    return (await this.fullStatus()).backend
  }

  async fullStatus(): Promise<SkillshareFullStatus> {
    const det = await this.detect()
    if (!det.installed) {
      return {
        backend: {
          id: this.id,
          installed: false,
          healthy: false,
          issues: [{ severity: "error", backend: this.id, message: "skillshare not installed", fix: "unify init" }],
        },
        targets: [],
        skills: [],
      }
    }

    const issues: HealthIssue[] = []
    if (det.version !== SKILLSHARE_PINNED_VERSION) {
      issues.push({
        severity: "warn",
        backend: this.id,
        message: `version ${det.version} != pinned ${SKILLSHARE_PINNED_VERSION}`,
        fix: "unify backends update",
      })
    }

    const listOut = await this.d.runner(["target", "list"])
    const managed = listOut.code === 0 ? parseTargetList(listOut.stdout) : []
    const managedNames = new Set(managed.map((t) => t.name))
    const skills = await listSourceSkills(this.source)
    const installed = await detectInstalledTools(this.d.home)

    const targets: TargetRow[] = []
    for (const t of managed) {
      const dir = expandTilde(t.skillsPath, this.d.home)
      const missing = skills.filter((s) => !entryExists(path.join(dir, s)))
      targets.push({
        target: t.name,
        tool: t.name,
        state: missing.length > 0 ? "drift" : "in-sync",
        detail:
          missing.length > 0
            ? `${missing.length} skill(s) not linked: ${missing.slice(0, 3).join(", ")}${missing.length > 3 ? "…" : ""}`
            : `${skills.length} skill(s) linked`,
      })
      if (missing.length > 0) {
        issues.push({
          severity: "warn",
          backend: this.id,
          message: `${t.name}: ${missing.length} source skill(s) not linked`,
          fix: "unify sync",
        })
      }
    }

    for (const tool of installed) {
      if (managedNames.has(tool)) continue
      targets.push({ target: tool, tool, state: "missing", detail: "installed on machine, not a skillshare target" })
      issues.push({
        severity: "warn",
        backend: this.id,
        message: `${tool} is installed but never synced`,
        fix: `skillshare target add ${tool}`,
      })
    }

    for (const tool of Object.keys(KNOWN_TOOLS)) {
      if (managedNames.has(tool) || installed.includes(tool)) continue
      targets.push({ target: tool, tool, state: "not-installed" })
    }

    return {
      backend: {
        id: this.id,
        installed: true,
        version: det.version,
        pinnedVersion: SKILLSHARE_PINNED_VERSION,
        healthy: issues.length === 0,
        issues,
      },
      targets,
      skills,
    }
  }

  async sync(options: SyncOptions): Promise<SyncResult> {
    const args = options.dryRun ? ["sync", "--dry-run", "--json"] : ["sync", "--json"]
    const r = await this.d.runner(args)
    if (r.code !== 0) {
      return {
        backend: this.id,
        dryRun: options.dryRun,
        changes: [],
        error: (r.stderr || r.stdout).trim() || `skillshare sync exited ${r.code}`,
      }
    }
    const p = parseSyncJson(r.stdout)
    return {
      backend: this.id,
      dryRun: options.dryRun,
      changes: p.details.map((x) => ({
        target: x.name,
        action: `${x.linked} linked, ${x.updated} updated, ${x.pruned} pruned`,
      })),
    }
  }

  async doctor(): Promise<HealthIssue[]> {
    const issues: HealthIssue[] = []
    const det = await this.detect()
    if (!det.installed) {
      return [{ severity: "error", backend: this.id, message: "skillshare not installed", fix: "unify init" }]
    }
    if (det.version !== SKILLSHARE_PINNED_VERSION) {
      issues.push({
        severity: "warn",
        backend: this.id,
        message: `version ${det.version} != pinned ${SKILLSHARE_PINNED_VERSION}`,
        fix: "unify backends update",
      })
    }
    const fs = await this.fullStatus()
    issues.push(...fs.backend.issues)
    if (!(await isDir(this.source))) {
      issues.push({
        severity: "warn",
        backend: this.id,
        message: `source directory missing: ${this.source}`,
        fix: "skillshare init",
      })
    }
    return issues
  }

  /**
   * Ensure skillshare is initialized (CLI-only, never edits its state files):
   * if no skillshare config exists, run `skillshare init --no-copy
   * --all-targets`; then ensure every desired target exists, adding missing
   * ones via `target add <name> <default-path>`.
   *
   * "Already initialized" is a success, not a failure: skillshare stores its
   * global config in %APPDATA% on Windows, so a path guess alone cannot decide
   * this — and a second `unify init` used to die on that error.
   */
  /**
   * True when skillshare already has a global config in any known location.
   * `env`/`platform` are injectable so tests aren't at the mercy of the
   * ambient $XDG_CONFIG_HOME (GitHub runners set it, which made the first
   * version of these tests fail only on CI).
   */
  async isInitialized(
    env: NodeJS.ProcessEnv = this.d.env ?? process.env,
    platform: NodeJS.Platform = this.d.platform ?? process.platform,
  ): Promise<boolean> {
    for (const p of skillshareConfigPaths(this.d.home, env, platform)) {
      if (await isFile(p)) return true
    }
    return false
  }

  async ensureState(desiredTargets: string[]): Promise<{ initialized: boolean; added: string[] }> {
    let initialized = false
    if (!(await this.isInitialized())) {
      const r = await this.d.runner(["init", "--no-copy", "--all-targets"])
      const out = (r.stderr || r.stdout).trim()
      if (r.code !== 0 && !/already initialized/i.test(out)) {
        throw new Error(`skillshare init failed: ${firstLine(out) || `exit ${r.code}`}`)
      }
      // non-zero + "already initialized" = someone (or a previous run) set it up
      initialized = r.code === 0
    }

    const listOut = await this.d.runner(["target", "list"])
    const managed = listOut.code === 0 ? parseTargetList(listOut.stdout) : []
    const have = new Set(managed.map((t) => t.name))
    const added: string[] = []
    for (const t of desiredTargets) {
      if (have.has(t)) continue
      const p = DEFAULT_SKILL_PATHS[t]
      if (!p) {
        // Unknown target name — nothing safe to guess a path from.
        continue
      }
      const r = await this.d.runner(["target", "add", t, p])
      if (r.code !== 0) {
        throw new Error(`skillshare target add ${t} failed: ${firstLine((r.stderr || r.stdout).trim()) || `exit ${r.code}`}`)
      }
      added.push(t)
    }
    return { initialized, added }
  }

  /**
   * Download the pinned release, verify SHA256, extract under
   * ~/.unify/backends/skillshare/. Throws on any mismatch/failure.
   *
   * Extraction is in-process (node:zlib): stock Windows has no `unzip`, and
   * the Windows asset is a .zip whose member is `skillshare.exe`. Relying on
   * external tools is what made `unify init` install "successfully" and then
   * report the binary as missing.
   */
  async install(
    manifest: BackendManifest,
    /** Target platform for the extracted member name (tests exercise win32). */
    platform: NodeJS.Platform = process.platform,
  ): Promise<void> {
    const cacheDir = path.join(this.stateHome, "cache")
    const destDir = path.join(this.stateHome, "backends", "skillshare")
    const binName = skillshareBinName(platform)
    const destBin = path.join(destDir, binName)
    const ext = manifest.source.endsWith(".zip") ? "zip" : "tar.gz"

    let res: Response
    try {
      res = await fetch(manifest.source)
    } catch (e) {
      throw new Error(`download failed: ${e instanceof Error ? e.message : String(e)}`)
    }
    if (!res.ok) throw new Error(`download failed: HTTP ${res.status} for ${manifest.source}`)
    let body: ArrayBuffer
    try {
      body = await res.arrayBuffer()
    } catch (e) {
      throw new Error(`download failed: ${e instanceof Error ? e.message : String(e)}`)
    }
    const buf = Buffer.from(body)

    const hash = createHash("sha256").update(buf).digest("hex")
    if (hash !== manifest.sha256) {
      throw new Error(`sha256 mismatch: expected ${manifest.sha256}, got ${hash}`)
    }

    await mkdir(cacheDir, { recursive: true })
    const tmp = path.join(cacheDir, `skillshare-${manifest.version}.${ext}`)
    await writeFile(tmp, buf)
    await mkdir(destDir, { recursive: true })

    let data: Uint8Array
    try {
      data = readMember(buf, binName)
    } catch (e) {
      throw new Error(`extract failed: ${e instanceof Error ? e.message : String(e)}`)
    }
    if (data.length === 0) throw new Error(`extract failed: ${binName} is empty`)
    await writeFile(destBin, data)
    // exec bit is a host-OS concern, not a target-platform one (a posix host
    // testing the win32 shape still needs it readable as a program)
    if (process.platform !== "win32") await chmod(destBin, 0o755)

    const v = await realRunner(destBin)(["--version"])
    if (v.code !== 0) {
      const why = (v.stderr || v.stdout).trim()
      throw new Error(`installed binary failed --version check${why ? `: ${why}` : ""}`)
    }
  }
}

function entryExists(p: string): boolean {
  try {
    statSync(p)
    return existsSync(p)
  } catch {
    return false
  }
}

async function listSourceSkills(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    return entries
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => e.name)
      .sort()
  } catch {
    return []
  }
}

export { parseTargetList, parseSyncJson, parseVersion, parseSkillList } from "./parse"
export type { ParsedTarget } from "./parse"
export { pinnedManifest, SKILLSHARE_PINNED_VERSION, currentPlatformKey } from "./manifest"
export { DEFAULT_SKILL_PATHS, KNOWN_TOOLS, detectInstalledTools } from "./tools"
