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
  const child = Bun.spawn([opts.cliPath], {
    env: { ...process.env, HOME: opts.home, ...(opts.env ?? {}) },
    stdin: "ignore",
    stdout: logFd,
    stderr: logFd,
    detached: true,
  })

  const timeout = opts.readyTimeoutMs ?? 180_000
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await probe(opts.baseUrl)) {
      // Bun keeps the event loop alive while a spawned child is live, even
      // detached — release it so the CLI can exit (the server keeps running).
      ;(child as unknown as { unref?: () => void }).unref?.()
      return { started: true }
    }
    await new Promise((r) => setTimeout(r, 1000))
  }

  // Never leave a half-started supervisor behind.
  try {
    process.kill(-child.pid, "SIGKILL")
  } catch {
    try {
      process.kill(child.pid, "SIGKILL")
    } catch {
      /* already gone */
    }
  }
  let tail = ""
  try {
    tail = readFileSync(opts.logFile, "utf8").slice(-2000)
  } catch {
    /* no log */
  }
  throw new Error(
    `agentmemory server not ready within ${timeout}ms. Log tail:\n${tail}`.trim(),
  )
}

export async function stop(
  cliPath: string,
  home: string,
  extraEnv: Record<string, string> = {},
): Promise<void> {
  const p = Bun.spawn([cliPath, "stop"], {
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
