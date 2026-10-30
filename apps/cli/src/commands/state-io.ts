import {
  type BackendManifest,
  type HealthIssue,
  type SyncChange,
  type SyncResult,
  type UnifiedStatus,
  pathsFor,
} from "@unify/core"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

export interface LastSyncEntry {
  at: string
  backend: string
  dryRun: boolean
  changes: SyncChange[]
}

/** Read backends.lock.json; null when absent. */
export async function readLock(home: string): Promise<Record<string, BackendManifest> | null> {
  try {
    const t = await readFile(pathsFor(home).lock, "utf8")
    return JSON.parse(t) as Record<string, BackendManifest>
  } catch {
    return null
  }
}

export async function writeLock(home: string, lock: Record<string, BackendManifest>): Promise<void> {
  const p = pathsFor(home).lock
  await writeFile(p, JSON.stringify(lock, null, 2) + "\n", "utf8")
}

/** Read state/last-sync.json; null when absent. */
export async function readLastSync(home: string): Promise<LastSyncEntry | null> {
  try {
    const t = await readFile(pathsFor(home).lastSync, "utf8")
    return JSON.parse(t) as LastSyncEntry
  } catch {
    return null
  }
}

export async function writeLastSync(home: string, entry: LastSyncEntry): Promise<void> {
  const p = pathsFor(home).lastSync
  await mkdir(path.dirname(p), { recursive: true })
  await writeFile(p, JSON.stringify(entry, null, 2) + "\n", "utf8")
}

// ---------- renderers (pure — golden-tested) ----------

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length)
}

/** One-screen status table (golden-tested for exact output). */
export function renderStatus(s: UnifiedStatus, lastSync: LastSyncEntry | null, memoryLine: string): string {
  const lines: string[] = []
  lines.push(`unify — status (profile: ${s.profile})`)
  lines.push("")
  lines.push(pad("BACKEND", 12) + " " + pad("VERSION", 9) + " " + pad("PINNED", 9) + " HEALTH")
  for (const b of s.backends) {
    const health = !b.installed
      ? "not-installed"
      : b.healthy
        ? "ok"
        : `${b.issues.length} issue(s)`
    lines.push(
      pad(b.id, 12) + " " + pad(b.version ?? "-", 9) + " " + pad(b.pinnedVersion ?? "-", 9) + " " + health,
    )
  }
  lines.push("")
  lines.push(pad("TARGET", 12) + " " + pad("STATE", 14) + " DETAIL")
  for (const t of s.targets) {
    lines.push((pad(t.target, 12) + " " + pad(t.state, 14) + (t.detail ?? "")).trimEnd())
  }
  lines.push("")
  lines.push(`Memory: ${memoryLine}`)
  lines.push(`Last sync: ${lastSync ? lastSync.at : "never"}`)
  return lines.join("\n")
}

/** Sync result table (golden-tested). */
export function renderSync(res: SyncResult, rows: SyncChange[]): string {
  const lines: string[] = []
  lines.push(`skillshare sync${res.dryRun ? " (dry-run)" : ""}`)
  for (const c of rows) lines.push(pad(c.target, 12) + " " + c.action)
  if (res.error) lines.push(`error: ${res.error}`)
  return lines.join("\n")
}

/** Doctor report (golden-tested). */
export function renderDoctor(issues: HealthIssue[]): string {
  if (issues.length === 0) return "doctor: all checks passed"
  return issues
    .map((i) => {
      const tag = i.severity === "error" ? "ERROR" : i.severity === "warn" ? "WARN " : "INFO "
      const fix = i.fix ? ` (fix: ${i.fix})` : ""
      return `${tag} [${i.backend}] ${i.message}${fix}`
    })
    .join("\n")
}
