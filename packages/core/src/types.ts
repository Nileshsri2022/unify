// @unify/core — shared types (DESIGN.md §4 data model).
// These are the single source of truth for CLI, API and dashboard shapes.

export type Severity = "info" | "warn" | "error"

export interface HealthIssue {
  severity: Severity
  backend: string
  message: string
  fix?: string
}

export interface Detection {
  installed: boolean
  path?: string
  version?: string
}

export interface BackendManifest {
  version: string
  sha256: string
  source: string
}

export interface BackendStatus {
  id: string
  installed: boolean
  version?: string
  pinnedVersion?: string
  healthy: boolean
  issues: HealthIssue[]
}

export type TargetState = "in-sync" | "drift" | "missing" | "not-installed"

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

export interface SyncOptions {
  dryRun: boolean
  targets?: string[]
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

export interface BackendAdapter {
  id: string
  detect(): Promise<Detection>
  install(manifest: BackendManifest): Promise<void>
  status(): Promise<BackendStatus>
  sync(options: SyncOptions): Promise<SyncResult>
  doctor(): Promise<HealthIssue[]>
}
