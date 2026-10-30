import { chmod, mkdir, stat } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

export interface UnifyPaths {
  home: string
  config: string
  lock: string
  lastSync: string
  backendsBin: string
  cache: string
}

/** ~/.unify, or $UNIFY_HOME when set (used by tests and e2e scripts). */
export function unifyHome(): string {
  return process.env.UNIFY_HOME || path.join(os.homedir(), ".unify")
}

export function pathsFor(home: string): UnifyPaths {
  return {
    home,
    config: path.join(home, "unify.yaml"),
    lock: path.join(home, "backends.lock.json"),
    lastSync: path.join(home, "state", "last-sync.json"),
    backendsBin: path.join(home, "backends"),
    cache: path.join(home, "cache"),
  }
}

/** Paths for the current process (evaluated lazily by callers via pathsFor(unifyHome())). */
export const paths: UnifyPaths = pathsFor(unifyHome())

export const HOME_MODE = 0o700

export async function ensureHome(home: string = paths.home): Promise<void> {
  await mkdir(home, { recursive: true })
  await chmod(home, HOME_MODE)
  for (const sub of ["state", "backends", "cache"]) {
    await mkdir(path.join(home, sub), { recursive: true })
  }
}

/** True when dir exists; used by doctor-style checks. */
export async function isDir(p: string): Promise<boolean> {
  try {
    const s = await stat(p)
    return s.isDirectory()
  } catch {
    return false
  }
}

/** True when a regular file exists. */
export async function isFile(p: string): Promise<boolean> {
  try {
    const s = await stat(p)
    return s.isFile()
  } catch {
    return false
  }
}

export function expandTilde(p: string, home: string): string {
  if (p === "~" || p === "~/" || p === "~\\") return home
  if (p.startsWith("~/") || p.startsWith("~\\")) {
    // skillshare on Windows reports paths like ~\.config\opencode\skills,
    // while POSIX reports ~/.claude/skills. Split on both separators so
    // the result is correct on either OS — previously only "~/" was
    // expanded, so every Windows backslash path was left literally
    // starting with "~\" and never found on disk.
    const parts = p.slice(2).split(/[\\/]/).filter(Boolean)
    return path.join(home, ...parts)
  }
  return p
}
