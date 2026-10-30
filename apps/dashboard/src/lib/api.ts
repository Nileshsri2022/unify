// JSON API client for `unify ui` (docs/plans/M5-ui-integration.md).
// Relative /api/* paths: same origin in production (unify ui serves both),
// proxied to 127.0.0.1:7420 in vite dev.

export type Severity = "error" | "warn" | "info"
export type TargetState = "in-sync" | "drift" | "missing" | "not-installed"

export interface HealthIssue {
  severity: Severity
  backend: string
  message: string
  fix?: string
}

export interface BackendStatus {
  id: string
  installed: boolean
  version?: string
  pinnedVersion?: string
  healthy: boolean
  issues: HealthIssue[]
}

export interface TargetRow {
  target: string
  tool: string
  state: TargetState
  lastSync?: string
  detail?: string
}

export interface MemorySummary {
  namespaces: { name: string; count: number }[]
  total: number
  lastCapture?: string
}

export interface UnifiedStatus {
  profile: string
  backends: BackendStatus[]
  targets: TargetRow[]
  memory: MemorySummary
  generatedAt: string
}

export interface SyncChange {
  target: string
  action: string
}

export interface SyncResult {
  backend: string
  dryRun: boolean
  changes: SyncChange[]
  error?: string
}

export interface LastSyncEntry {
  at: string
  backend: string
  dryRun: boolean
  changes: SyncChange[]
}

export interface RecallResult {
  obsId: string
  score: number
  title: string
  type: string
}

export interface ApiProfile {
  name: string
  active: boolean
  backends: {
    skillshare: { enabled: boolean; targets: string[] }
    agentmemory: { enabled: boolean; namespace: string }
  }
}

// ---- response shapes -------------------------------------------------------

export interface StatusResponse {
  status: UnifiedStatus
  lastSync: LastSyncEntry | null
  memoryLine: string
}

export interface DoctorResponse {
  issues: HealthIssue[]
}

export interface ProfilesResponse {
  active: string
  profiles: ApiProfile[]
}

export interface MemoryResponse {
  profile: string
  namespace: string
  results: RecallResult[]
}

export interface MemorySaveResponse {
  id: string
  profile: string
}

export interface SyncResponse {
  result: SyncResult
  glue: string[]
  lastSync: LastSyncEntry | null
}

// ---- client ----------------------------------------------------------------

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = "ApiError"
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      headers: { "content-type": "application/json" },
      ...init,
    })
  } catch (e) {
    throw new ApiError(0, `API unreachable (${e instanceof Error ? e.message : e})`)
  }
  if (!res.ok) {
    let msg = res.statusText
    try {
      const body = (await res.json()) as { error?: string }
      if (body.error) msg = body.error
    } catch {
      /* keep statusText */
    }
    throw new ApiError(res.status, msg)
  }
  return (await res.json()) as T
}

export const api = {
  status: () => request<StatusResponse>("/api/status"),
  doctor: () => request<DoctorResponse>("/api/doctor"),
  profiles: () => request<ProfilesResponse>("/api/profiles"),
  memory: (q: string, limit = 10, profile?: string) =>
    request<MemoryResponse>(
      `/api/memory?q=${encodeURIComponent(q)}&limit=${limit}${profile ? `&profile=${encodeURIComponent(profile)}` : ""}`,
    ),
  saveMemory: (text: string, concepts: string[] = []) =>
    request<MemorySaveResponse>("/api/memory", {
      method: "POST",
      body: JSON.stringify({ text, concepts }),
    }),
  switchProfile: (name: string) =>
    request<ProfilesResponse & { active: string }>("/api/profiles", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  sync: (dryRun: boolean, target?: string) =>
    request<SyncResponse>("/api/sync", {
      method: "POST",
      body: JSON.stringify({ dryRun, target }),
    }),
}

/** Human "2 min ago" from an ISO timestamp. */
export function ago(iso?: string): string {
  if (!iso) return "never"
  const ms = Date.now() - new Date(iso).getTime()
  if (Number.isNaN(ms)) return "never"
  const m = Math.floor(ms / 60000)
  if (m < 1) return "just now"
  if (m < 60) return `${m} min ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} h ago`
  return `${Math.floor(h / 24)} d ago`
}
