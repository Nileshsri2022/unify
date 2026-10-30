import { createHash } from "node:crypto"
import { chmod, mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { isFile } from "@unify/core"
import { readMember } from "../archive"
import { realRunner } from "../runner"

/**
 * iii-engine provisioning.
 *
 * agentmemory 0.9.31 refuses to auto-install its engine on Windows (and for any
 * .zip asset): it needs `sh`/`curl`/`tar`, prints a "Setup required" box and
 * never starts — which surfaced in `unify init` as a 180 s hang followed by a
 * 60-line dump. unify provisions the engine itself instead:
 *
 *   fetch → SHA-256 verify (pinned, same hashes agentmemory checks)
 *         → extract in-process (no unzip/tar needed)
 *         → ~/.agentmemory/bin/iii(.exe)  ← where agentmemory looks first
 */

/**
 * Default pinned engine version — must match the agentmemory release we pin.
 *
 * 0.22.1 is the engine agentmemory 0.9.30 expects. We pin that release rather
 * than 0.9.31 because 0.9.31 starts its workers through `iii compose`, whose
 * Windows shell handling cannot run a script container (it passes the script
 * through Command::args, Rust escapes the quotes, and cmd.exe fails with
 * "The network path was not found."). 0.9.30 has no Compose layer.
 */
export const III_PINNED_VERSION = "0.22.1"

/**
 * SHA-256 pins per release asset, copied from `III_RELEASE_SHA256` in
 * @agentmemory/agentmemory 0.9.31 so a unify-installed engine passes
 * agentmemory's own integrity check.
 */
export const III_RELEASE_SHA256: Record<string, Record<string, string>> = {
  // agentmemory 0.9.30's table — the pin we ship.
  "0.22.1": {
    "iii-aarch64-apple-darwin.tar.gz": "2b309019b909a896cae874dc947e2cdf877b4f3c51dd026b79850af858517fa4",
    "iii-x86_64-apple-darwin.tar.gz": "6d33940db2d3ad6a9aef9837aa5b89bf5c5e4acd0679e8178fec258af229d7e1",
    "iii-x86_64-unknown-linux-gnu.tar.gz":
      "34d4bd2ec1873e6114bb836be7db9cb3f410d0d63353d240917f0bc9c30df13b",
    "iii-aarch64-unknown-linux-gnu.tar.gz":
      "87efc60210c1580ef2e11b13c679a4dad91917a9d80f737c5ba7e3475b3ca413",
    "iii-armv7-unknown-linux-gnueabihf.tar.gz":
      "af5dfc45149678c647e5adaca55c055428eebfa73d65884b052c30c98abcfd19",
    "iii-x86_64-pc-windows-msvc.zip":
      "d862bf7cf1e864f3290c8a6fc17c308c6ecac097cb2666e4a739efc0040aae96",
    "iii-aarch64-pc-windows-msvc.zip":
      "4777a48cee3fc1a742daee929e3d943df09e4ddd3357d27a33d31c9dc9e520ac",
  },
  // agentmemory 0.9.31's table — kept so a 0.9.31 tree can still be verified.
  "0.25.0": {
    "iii-aarch64-apple-darwin.tar.gz": "5f23087a41ce1cf86f9859d2f430d1809a1e048094e69b1df0cdf1ebefc2a985",
    "iii-x86_64-apple-darwin.tar.gz": "e2ac4ef109ddbf459b4683171c6b5b9c8366b16dac2e1f8c4fe08b4a4e19d49a",
    "iii-x86_64-unknown-linux-gnu.tar.gz":
      "4c4d14063eb55d79663db553e960497731420df6d78eca3aafe670e2fbaba8e2",
    "iii-aarch64-unknown-linux-gnu.tar.gz":
      "5e52d4738a0beb609f4d32970d37be7c00d4848ee9d06300248498a00ea4bf0e",
    "iii-armv7-unknown-linux-gnueabihf.tar.gz":
      "9ee840351ff62c889b929b618f8cbb2d66d616cecf82cde7c26d4618aa137508",
    "iii-x86_64-pc-windows-msvc.zip":
      "b80ea5c3408879380b6ce95f7b2855ce161d68642aeec8f7b54f104794cbb322",
    "iii-aarch64-pc-windows-msvc.zip":
      "2b1e222b90ee18ed143186e8b307d8ad2076f44ea00fa7a7d071bd3c87cde002",
  },
}

export const III_RELEASE_BASE = "https://github.com/iii-hq/iii/releases/download"

export type EngineErrorCode =
  | "unsupported-platform"
  | "no-checksum"
  | "download"
  | "checksum"
  | "extract"
  | "verify"

export class EngineError extends Error {
  constructor(
    readonly code: EngineErrorCode,
    message: string,
  ) {
    super(message)
    this.name = "EngineError"
  }
}

/** Release asset for a platform/arch pair — mirrors agentmemory's mapping. */
export function iiiAssetFor(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string | null {
  if (platform === "darwin" && arch === "arm64") return "iii-aarch64-apple-darwin.tar.gz"
  if (platform === "darwin" && arch === "x64") return "iii-x86_64-apple-darwin.tar.gz"
  if (platform === "linux" && arch === "x64") return "iii-x86_64-unknown-linux-gnu.tar.gz"
  if (platform === "linux" && arch === "arm64") return "iii-aarch64-unknown-linux-gnu.tar.gz"
  if (platform === "linux" && arch === "arm") return "iii-armv7-unknown-linux-gnueabihf.tar.gz"
  if (platform === "win32" && arch === "x64") return "iii-x86_64-pc-windows-msvc.zip"
  if (platform === "win32" && arch === "arm64") return "iii-aarch64-pc-windows-msvc.zip"
  return null
}

/** Binary name inside the archive and on disk. */
export function engineBinName(platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? "iii.exe" : "iii"
}

/** Where agentmemory looks first: `<home>/.agentmemory/bin/iii(.exe)`. */
export function engineInstallPath(
  home: string,
  platform: NodeJS.Platform = process.platform,
): string {
  return path.join(home, ".agentmemory", "bin", engineBinName(platform))
}

export function iiiReleaseUrl(
  asset: string,
  version: string = III_PINNED_VERSION,
  base: string = III_RELEASE_BASE,
): string {
  return `${base}/iii/v${version}/${asset}`
}

export interface EnsureEngineOptions {
  /** User home — the engine is installed under `<home>/.agentmemory/bin`. */
  home: string
  platform?: NodeJS.Platform
  arch?: string
  version?: string
  /** Override the release base URL (tests: file:// directory). */
  releaseBase?: string
  /** Override the checksum table (tests / future pins). */
  checksums?: Record<string, string>
  /** Progress listener; defaults to silent. */
  log?: (line: string) => void
}

export interface EnsureEngineResult {
  /** true when this call installed the binary; false when it was already there. */
  installed: boolean
  path: string
  /** `iii --version` output, when it could be read. */
  version?: string
}

export interface AgentmemoryProbeResult {
  /** agentmemory would accept this binary. */
  ok: boolean
  /** Version parsed from stdout the way agentmemory parses it. */
  version?: string
  stdout: string
  stderr: string
  code: number | null
  ms: number
  timedOut: boolean
  error?: string
}

/**
 * Reproduce agentmemory 0.9.31's *own* engine check — `iiiBinVersion()`:
 *
 *   execFileSync(bin, ["--version"], { stdio: ["ignore", "pipe", "ignore"],
 *                                      timeout: 3000 }).match(/(\d+\.\d+\.\d+)/)
 *
 * That is stricter than anything unify does: stdout only (stderr is
 * discarded), a hard 3 s timeout, and any non-zero exit throws. A binary unify
 * happily accepts can therefore still be rejected here, after which agentmemory
 * reports "Could not start iii-engine" and falls into an installer that cannot
 * work on Windows. Running this first turns that mystery into one line.
 */
export async function probeEngineAsAgentmemory(
  bin: string,
  timeoutMs = 3000,
): Promise<AgentmemoryProbeResult> {
  const started = Date.now()
  let proc: ReturnType<typeof Bun.spawn>
  try {
    proc = Bun.spawn([bin, "--version"], { stdin: "ignore", stdout: "pipe", stderr: "pipe" })
  } catch (e) {
    return {
      ok: false,
      stdout: "",
      stderr: "",
      code: null,
      ms: Date.now() - started,
      timedOut: false,
      error: e instanceof Error ? e.message : String(e),
    }
  }

  // Drain immediately: a full pipe buffer would deadlock the child.
  const readers = Promise.all([
    new Response(proc.stdout as ReadableStream).text().catch(() => ""),
    new Response(proc.stderr as ReadableStream).text().catch(() => ""),
  ])

  let timedOut = false
  const code = await Promise.race([
    proc.exited,
    new Promise<null>((resolve) =>
      setTimeout(() => {
        timedOut = true
        try {
          proc.kill()
        } catch {
          /* already gone */
        }
        resolve(null)
      }, timeoutMs),
    ),
  ])

  // After a kill the pipes can stay open (a grandchild may still hold them),
  // so never block the CLI on a dying tree — fall back to empty output.
  const [stdout, stderr] = await Promise.race([
    readers,
    new Promise<[string, string]>((resolve) => setTimeout(() => resolve(["", ""]), timedOut ? 150 : 2000)),
  ])

  const match = stdout.match(/(\d+\.\d+\.\d+(?:[-+][\w.]+)?)/)
  return {
    ok: !timedOut && code === 0 && match !== null,
    version: match?.[1],
    stdout: stdout.trim(),
    stderr: stderr.trim(),
    code,
    ms: Date.now() - started,
    timedOut,
  }
}

/** Human-readable one-liner for a failed probe. */
export function describeProbeFailure(p: AgentmemoryProbeResult): string {
  const bits: string[] = []
  bits.push(p.timedOut ? `no answer within 3s` : `exit ${p.code ?? "?"}`)
  bits.push(`${p.ms}ms`)
  if (p.error) bits.push(p.error)
  if (p.stdout === "" && !p.timedOut) bits.push("stdout empty")
  if (p.stderr) bits.push(`stderr: ${p.stderr.split("\n")[0].slice(0, 120)}`)
  return bits.join(", ")
}

async function engineVersion(bin: string): Promise<string | undefined> {
  const r = await realRunner(bin)(["--version"])
  if (r.code !== 0) return undefined
  const v = (r.stdout || r.stderr).trim().split("\n")[0]
  return v || undefined
}

/**
 * Make sure the pinned iii binary exists, downloading and verifying it if not.
 * Throws EngineError with an actionable message on any failure.
 */
export async function ensureEngine(opts: EnsureEngineOptions): Promise<EnsureEngineResult> {
  const platform = opts.platform ?? process.platform
  const arch = opts.arch ?? process.arch
  const version = opts.version ?? III_PINNED_VERSION
  const binPath = engineInstallPath(opts.home, platform)

  if (await isFile(binPath)) {
    const v = await engineVersion(binPath)
    if (v) {
      // agentmemory requires the pinned version exactly (see
      // resolveCompatibleIii in its bundle): a runnable but stale binary —
      // e.g. iii 0.25.0 left over from the agentmemory 0.9.31 era when the
      // pin is 0.22.1 — is rejected by agentmemory, and on Windows it cannot
      // auto-install the pinned engine itself, so every start fails the
      // same way until the stale binary is replaced. Compare the reported
      // version to the pin, not just "does it run".
      const reported = v.match(/(\d+\.\d+\.\d+(?:[-+][\w.]+)?)/)?.[1]
      if (reported === version) return { installed: false, path: binPath, version: v }
      opts.log?.(`existing ${binPath} reports v${reported ?? "?"} (expected v${version}); reinstalling`)
    } else {
      // present but not runnable (wrong arch / partial copy) — reinstall below
      opts.log?.(`existing ${binPath} did not run; reinstalling`)
    }
  }

  const asset = iiiAssetFor(platform, arch)
  if (!asset) {
    throw new EngineError(
      "unsupported-platform",
      `no iii-engine build for ${platform}/${arch} — agentmemory needs iii v${version}; install it manually and re-run`,
    )
  }

  const table = opts.checksums ?? III_RELEASE_SHA256[version]
  const expected = table?.[asset]
  if (!expected) {
    throw new EngineError(
      "no-checksum",
      `no pinned SHA-256 for ${asset} in iii v${version} — refusing to install an unverified engine`,
    )
  }

  const url = iiiReleaseUrl(asset, version, opts.releaseBase)
  opts.log?.(`downloading iii v${version} (${asset}) …`)
  let res: Response
  try {
    res = await fetch(url)
  } catch (e) {
    throw new EngineError("download", `download failed: ${e instanceof Error ? e.message : e}`)
  }
  if (!res.ok) throw new EngineError("download", `download failed: HTTP ${res.status} for ${url}`)

  let buf: Buffer
  try {
    buf = Buffer.from(await res.arrayBuffer())
  } catch (e) {
    throw new EngineError("download", `download failed: ${e instanceof Error ? e.message : e}`)
  }

  const actual = createHash("sha256").update(buf).digest("hex")
  if (actual !== expected) {
    throw new EngineError(
      "checksum",
      `SHA-256 mismatch for ${asset}: expected ${expected}, got ${actual} — nothing was installed`,
    )
  }

  let data: Uint8Array
  try {
    data = readMember(buf, engineBinName(platform))
  } catch (e) {
    throw new EngineError("extract", `extract failed: ${e instanceof Error ? e.message : e}`)
  }
  if (data.length === 0) throw new EngineError("extract", `extract failed: ${engineBinName(platform)} is empty`)

  await mkdir(path.dirname(binPath), { recursive: true })
  await writeFile(binPath, data)
  // the exec bit is a host concern: a posix host extracting the win32 zip for
  // tests still needs it runnable, and windows ignores the mode
  if (process.platform !== "win32") await chmod(binPath, 0o755)

  const v = await engineVersion(binPath)
  if (!v) {
    throw new EngineError(
      "verify",
      `installed ${binPath} but it did not run — wrong platform build? delete it and re-run`,
    )
  }
  opts.log?.(`iii ${v} installed → ${binPath}`)
  return { installed: true, path: binPath, version: v }
}
