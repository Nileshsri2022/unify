/**
 * agentmemory server lifecycle for unify: probe / ensureRunning / stop.
 *
 * `agentmemory` (default command) is a FOREGROUND supervisor — unify spawns it
 * detached with stdio redirected to a log file, then polls the unauthenticated
 * `/agentmemory/livez` endpoint until ready. First start downloads the pinned
 * iii-engine, so the default timeout is generous (180s).
 */

import { openSync, readFileSync, statSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { agentmemoryArgv, agentmemoryComposeLog } from "./command"

export async function probe(baseUrl: string, timeoutMs = 3000): Promise<boolean> {
  const base = baseUrl.replace(/\/$/, "")
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`${base}/agentmemory/livez`, { signal: ctrl.signal })
    if (!res.ok) return false
    const d = (await res.json()) as { status?: string }
    return d.status === "ok"
  } catch {
    return false
  } finally {
    clearTimeout(t)
  }
}

export interface EnsureRunningOptions {
  /** Path to the agentmemory bin (…/backends/agentmemory/node_modules/.bin/agentmemory). */
  cliPath: string
  /** JS entry — required on win32, where the npm shim is not executable. */
  entryPath?: string
  /** User home — passed as $HOME to the spawned server (isolates its state). */
  home: string
  baseUrl: string
  logFile: string
  /** First-run downloads the engine; default 180s. */
  readyTimeoutMs?: number
  /** Extra env for the spawned process (tests). */
  env?: Record<string, string>
}

/**
 * Attach the Compose daemon log when the supervisor died trying to start its
 * project. Only read when the log mentions Compose at all, so an engine or
 * port problem does not grow an unrelated block.
 */
function withCompose(message: string, opts: { home: string; env?: Record<string, string> }): string {
  if (!/compose|PROJECT_DID_NOT_START|did not start/i.test(message)) return message
  const composeLog = agentmemoryComposeLog({
    home: opts.home,
    env: { ...process.env, ...(opts.env ?? {}) },
  })
  const lines = composeFailureLines(composeLog)
  if (lines.length === 0) return message
  const rel = composeLog.replace(/\\/g, "/")
  return withSection(message, `compose log (${rel})`, lines)
}

export async function ensureRunning(
  opts: EnsureRunningOptions,
): Promise<{ started: boolean }> {
  if (await probe(opts.baseUrl)) return { started: false }

  await mkdir(path.dirname(opts.logFile), { recursive: true })
  // The log is append-only and shared across runs, so remember where this run
  // starts: a "Could not start iii-engine" line from a *previous* attempt must
  // never abort the current one (that false positive fired in ~1s and made a
  // good start look failed).
  const logOffset = sizeOf(opts.logFile)
  const logFd = openSync(opts.logFile, "a")
  // AGENTMEMORY_VERBOSE makes the dependency log its own engine discovery
  // ("iii binary: …", "fallback iii at … reports version: …"). That is the only
  // way to see WHY it rejects an engine unify considers installed, and it only
  // lands in the log file. UNIFY_MEMORY_VERBOSE=0 restores quiet behaviour.
  const verbose = process.env.UNIFY_MEMORY_VERBOSE === "0" ? {} : { AGENTMEMORY_VERBOSE: "1" }
  const child = Bun.spawn(agentmemoryArgv(opts.cliPath, opts.entryPath), {
    env: { ...process.env, HOME: opts.home, ...verbose, ...(opts.env ?? {}) },
    stdin: "ignore",
    stdout: logFd,
    stderr: logFd,
    detached: true,
  })

  const killChild = () => {
    try {
      process.kill(-child.pid, "SIGKILL")
    } catch {
      try {
        process.kill(child.pid, "SIGKILL")
      } catch {
        /* already gone */
      }
    }
  }

  let started = false
  try {
    const timeout = opts.readyTimeoutMs ?? 180_000
    const deadline = Date.now() + timeout
    // A supervisor can fail immediately (missing engine, bad config, port in
    // use). Watching it means a failure known after ~2s never costs 180s.
    const exited = child.exited.then((code) => ({ code }))
    while (Date.now() < deadline) {
      if (await probe(opts.baseUrl)) {
        // Bun keeps the event loop alive while a spawned child is live, even
        // detached — release it so the CLI can exit (the server keeps running).
        ;(child as unknown as { unref?: () => void }).unref?.()
        started = true
        return { started: true }
      }
      const dead = await Promise.race([
        exited,
        new Promise<null>((r) => setTimeout(() => r(null), 1000)),
      ])
      if (dead && !(await probe(opts.baseUrl))) {
        throw new Error(
          withCompose(
            withTrace(
              `agentmemory exited before it was ready (exit ${dead.code}). Log tail:\n${tailOf(opts.logFile, 10, logOffset)}`,
              engineTrace(opts.logFile, logOffset),
            ),
            opts,
          ),
        )
      }
      // The supervisor can also stay alive after giving up on a fatal problem
      // (agentmemory does this when iii-engine cannot start). Waiting out the
      // remaining minutes only delays a failure that is already on screen.
      const fatal = fatalEngineLine(opts.logFile, logOffset)
      if (fatal) {
        const line = fatal.replace(/[.\s]+$/, "")
        throw new Error(
          withCompose(
            withTrace(
              `agentmemory cannot start: ${line}. Log tail:\n${tailOf(opts.logFile, 10, logOffset)}`,
              engineTrace(opts.logFile, logOffset),
            ),
            opts,
          ),
        )
      }
    }
    throw new Error(
      `agentmemory server not ready within ${timeout}ms. Log tail:\n${tailOf(opts.logFile, 8, logOffset)}`.trim(),
    )
  } finally {
    // Reap the child on every failure path: a detached supervisor that keeps
    // running holds Bun's event loop open, so the CLI would stall on exit even
    // after it decided to give up (observed as a 60s hang with a sleep stub).
    if (!started) killChild()
  }
}

/**
 * Detect a fatal engine/bootstrap line in the supervisor log.
 * Returns the matching line (or null). Only unambiguous failures are listed —
 * a false positive would abort a start that was about to succeed.
 */
function sizeOf(file: string): number {
  try {
    return statSync(file).size
  } catch {
    return 0
  }
}

export function fatalEngineLine(logFile: string, offset = 0): string | null {
  let text = ""
  try {
    text = readFileSync(logFile, "utf8")
  } catch {
    return null
  }
  // Only what THIS run wrote counts. The log is append-only, so without the
  // offset a stale failure from a previous run aborts a healthy start.
  const fresh = offset > 0 ? text.slice(offset) : text
  if (fresh.trim() === "") return null
  const recent = fresh.slice(-4000)
  const patterns = [
    /Could not start iii-engine/i,
    /iii-engine could not be started/i,
    /Setup required/i,
    /iii-engine download failed/i,
    /EADDRINUSE/i,
  ]
  for (const line of recent.split("\n")) {
    if (patterns.some((p) => p.test(line))) return line.trim().replace(/^[^A-Za-z]+/, "")
  }
  return null
}

/**
 * Last few log lines, filtered to what is actionable. agentmemory prints a
 * 60-line decorated "Setup required" box; repeating all of it tells the user
 * nothing they can act on.
 */
/**
 * Lines from *this run* that explain engine discovery, e.g.
 *   iii binary: (not on PATH)
 *   fallback iii at C:\…\iii.exe reports version: 0.25.0
 * agentmemory only prints these with --verbose (which unify turns on), and
 * they are the only evidence of why it rejected an engine we believe is fine.
 */
/**
 * The Compose daemon's last meaningful lines. When the engine is accepted but
 * the project does not start, this holds the worker's actual error — the one
 * thing agentmemory's "Compose exited with code 1" never shows.
 */
export function composeFailureLines(logFile: string, max = 8): string[] {
  let text = ""
  try {
    text = readFileSync(logFile, "utf8")
  } catch {
    return []
  }
  const noise = /^\s*$|\bdownloading\b|\bprogress\b|^\s*[│|]|\u001b\[/i
  const lines: string[] = []
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\u001b\[[0-9;]*m/g, "").trimEnd()
    if (noise.test(line)) continue
    lines.push(line.trim())
  }
  return lines.slice(-max)
}

/** Append a labelled block to a failure message. */
function withSection(message: string, label: string, lines: string[]): string {
  return (lines.length ? `${message}\n${label}:\n${lines.join("\n")}` : message).trim()
}

/** Append agentmemory's engine-discovery lines to a failure message. */
function withTrace(message: string, trace: string[]): string {
  return (trace.length ? `${message}\nengine trace:\n${trace.join("\n")}` : message).trim()
}

export function engineTrace(logFile: string, offset = 0, max = 6): string[] {
  let text = ""
  try {
    text = readFileSync(logFile, "utf8")
  } catch {
    return []
  }
  const fresh = offset > 0 ? text.slice(offset) : text
  // discovery lines only — box text like "iii-engine could not be started." is
  // already in the log tail and would just bury the useful two lines
  const wanted = /iii binary|fallback iii|reports version|Using iii|pin is v|engine check/i
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of fresh.split("\n")) {
    const line = raw.replace(/\u001b\[[0-9;]*m/g, "").trim()
    if (!line || !wanted.test(line)) continue
    if (seen.has(line)) continue
    seen.add(line)
    out.push(line)
  }
  return out.slice(-max)
}

export function tailOf(logFile: string, lines = 8, offset = 0): string {
  let text = ""
  try {
    text = readFileSync(logFile, "utf8")
  } catch {
    return "(no log)"
  }
  const fresh = offset > 0 ? text.slice(offset) : text
  if (fresh.trim() === "" && offset > 0) return "(no output from this run)"
  const clean = fresh
    // box drawing / ANSI / cursor-control noise
    .replace(/\u001b\[[0-9;?]*[a-zA-Z]/g, "")
    .replace(/[│◇◆├└┌┐┘─╭╮╰╯■▲●]/g, " ")
    .split("\n")
    .map((l) => l.replace(/\s+$/, "").trim())
    .filter((l) => l.length > 0 && !/^[-=_. ]+$/.test(l))
    .filter((l) => !/^\d{1,2}:\d{2}:\d{2}\s*(AM|PM)$/.test(l))
  return (clean.length > lines ? ["…", ...clean.slice(-lines)] : clean).join("\n")
}

export async function stop(
  cliPath: string,
  home: string,
  extraEnv: Record<string, string> = {},
  entryPath?: string,
): Promise<void> {
  const p = Bun.spawn([...agentmemoryArgv(cliPath, entryPath), "stop"], {
    env: { ...process.env, HOME: home, ...extraEnv },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  const code = await p.exited
  if (code !== 0) {
    const err = await new Response(p.stderr).text()
    throw new Error(`agentmemory stop failed (${code}): ${err.trim()}`)
  }
}
