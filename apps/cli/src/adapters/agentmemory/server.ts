/**
 * agentmemory server lifecycle for unify: probe / ensureRunning / stop.
 *
 * `agentmemory` (default command) is a FOREGROUND supervisor — unify spawns it
 * detached with stdio redirected to a log file, then polls the unauthenticated
 * `/agentmemory/livez` endpoint until ready. First start downloads the pinned
 * iii-engine, so the default timeout is generous (180s).
 */

import { openSync, readFileSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { agentmemoryArgv } from "./command"

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

export async function ensureRunning(
  opts: EnsureRunningOptions,
): Promise<{ started: boolean }> {
  if (await probe(opts.baseUrl)) return { started: false }

  await mkdir(path.dirname(opts.logFile), { recursive: true })
  const logFd = openSync(opts.logFile, "a")
  const child = Bun.spawn(agentmemoryArgv(opts.cliPath, opts.entryPath), {
    env: { ...process.env, HOME: opts.home, ...(opts.env ?? {}) },
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
          `agentmemory exited before it was ready (exit ${dead.code}). Log tail:\n${tailOf(opts.logFile)}`.trim(),
        )
      }
      // The supervisor can also stay alive after giving up on a fatal problem
      // (agentmemory does this when iii-engine cannot start). Waiting out the
      // remaining minutes only delays a failure that is already on screen.
      const fatal = fatalEngineLine(opts.logFile)
      if (fatal) {
        throw new Error(`agentmemory cannot start: ${fatal}. Log tail:\n${tailOf(opts.logFile)}`.trim())
      }
    }
    throw new Error(
      `agentmemory server not ready within ${timeout}ms. Log tail:\n${tailOf(opts.logFile)}`.trim(),
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
export function fatalEngineLine(logFile: string): string | null {
  let text = ""
  try {
    text = readFileSync(logFile, "utf8")
  } catch {
    return null
  }
  // only the tail matters: an old failure from a previous run must not abort
  const recent = text.slice(-4000)
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
export function tailOf(logFile: string, lines = 8): string {
  let text = ""
  try {
    text = readFileSync(logFile, "utf8")
  } catch {
    return "(no log)"
  }
  const clean = text
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
