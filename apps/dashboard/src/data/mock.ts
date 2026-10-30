// Mock data — mirrors packages/core types (DESIGN.md §4).
// Real data comes from adapter status() calls once M1 lands.

export type TargetState = "in-sync" | "drift" | "missing" | "not-installed"

export interface BackendStatus {
  id: string
  label: string
  installed: boolean
  version?: string
  pinnedVersion?: string
  healthy: boolean
  detail: string
  stat: string
}

export interface TargetRow {
  tool: string
  state: TargetState
  targets: number
  lastSync: string
  note?: string
}

export interface MemoryCapture {
  id: string
  namespace: "work" | "personal"
  kind: "correction" | "decision" | "preference" | "context"
  text: string
  source: string
  when: string
  superseded?: boolean
}

export interface DoctorIssue {
  id: string
  severity: "info" | "warn" | "error"
  backend: string
  message: string
  fix?: string
}

export interface Profile {
  id: "work" | "personal"
  name: string
  active: boolean
  memoryNamespace: string
  backends: {
    skillshare: { enabled: boolean; targets: string[] }
    agentmemory: { enabled: boolean; namespace: string }
  }
}

export const status = {
  profile: "work",
  lastSync: "2 min ago",
  generatedAt: "11:42 IST",
  backends: [
    {
      id: "skillshare",
      label: "skillshare",
      installed: true,
      version: "0.28.0",
      pinnedVersion: "0.28.0",
      healthy: true,
      detail: "config distribution · 76+ targets",
      stat: "6 targets synced",
    },
    {
      id: "agentmemory",
      label: "agentmemory",
      installed: true,
      version: "1.4.2",
      pinnedVersion: "1.4.2",
      healthy: true,
      detail: "persistent memory · MCP",
      stat: "1,204 memories · 2 namespaces",
    },
  ] satisfies BackendStatus[],
  targets: [
    { tool: "Claude Code", state: "in-sync", targets: 8, lastSync: "2 min ago" },
    { tool: "Cursor", state: "in-sync", targets: 6, lastSync: "2 min ago" },
    {
      tool: "Codex CLI",
      state: "drift",
      targets: 5,
      lastSync: "6 h ago",
      note: "MCP server `github` flags differ from pinned config",
    },
    { tool: "Gemini CLI", state: "in-sync", targets: 4, lastSync: "2 min ago" },
    { tool: "Windsurf", state: "missing", targets: 0, lastSync: "never", note: "installed on machine, never synced" },
    { tool: "Kiro", state: "not-installed", targets: 0, lastSync: "—" },
  ] satisfies TargetRow[],
}

export const memoryCaptures: MemoryCapture[] = [
  {
    id: "m-014",
    namespace: "work",
    kind: "decision",
    text: "Payments retry queue uses exponential backoff with jitter — do not switch to fixed delay (caused thundering herd in Q2).",
    source: "claude-code · session 8f3a",
    when: "12 min ago",
  },
  {
    id: "m-013",
    namespace: "work",
    kind: "correction",
    text: "Never touch `legacy/billing/` — migration ships next month, it is intentionally frozen.",
    source: "cursor · session 2c1d",
    when: "48 min ago",
  },
  {
    id: "m-012",
    namespace: "work",
    kind: "preference",
    text: "Prefer pnpm over npm for installs; repo uses pnpm workspaces.",
    source: "codex-cli · session 91be",
    when: "2 h ago",
  },
  {
    id: "m-011",
    namespace: "work",
    kind: "context",
    text: "Staging DB credentials rotate weekly on Monday; env file is refreshed by CI, not by hand.",
    source: "claude-code · session 77aa",
    when: "5 h ago",
  },
  {
    id: "m-010",
    namespace: "work",
    kind: "decision",
    text: "Chose zod over yup for API validation — smaller bundle, first-class TS inference.",
    source: "claude-code · session 41cd",
    when: "8 h ago",
  },
  {
    id: "m-009",
    namespace: "work",
    kind: "correction",
    text: "Tests must run with `bun test`, not vitest — vitest config was removed last sprint.",
    source: "cursor · session ab02",
    when: "1 d ago",
    superseded: true,
  },
  {
    id: "m-008",
    namespace: "personal",
    kind: "preference",
    text: "Home-lab scripts go in ~/homelab/scripts, always bash with set -euo pipefail.",
    source: "gemini-cli · session d4e9",
    when: "1 d ago",
  },
  {
    id: "m-007",
    namespace: "personal",
    kind: "context",
    text: "NAS at 192.168.1.10, SMB share `media` — agents must not write there, read-only.",
    source: "claude-code · session 5b77",
    when: "2 d ago",
  },
]

export const doctorIssues: DoctorIssue[] = [
  {
    id: "d-01",
    severity: "warn",
    backend: "skillshare",
    message: "Codex CLI drift: 2 MCP servers differ from pinned config",
    fix: "unify sync --target codex",
  },
  {
    id: "d-02",
    severity: "warn",
    backend: "skillshare",
    message: "AGENTS.md not found for 2 targets (Windsurf, Kiro)",
    fix: "unify doctor --fix",
  },
  {
    id: "d-03",
    severity: "info",
    backend: "all",
    message: "Backend versions pinned and SHA256 verified (skillshare 0.28.0, agentmemory 1.4.2)",
  },
  {
    id: "d-04",
    severity: "info",
    backend: "agentmemory",
    message: "14 captures added in last 24h · 1 superseded",
  },
  {
    id: "d-05",
    severity: "info",
    backend: "unify",
    message: "~/.unify permissions OK (0700) · state dir healthy",
  },
]

export const profiles: Profile[] = [
  {
    id: "work",
    name: "work",
    active: true,
    memoryNamespace: "work",
    backends: {
      skillshare: { enabled: true, targets: ["claude", "cursor", "codex", "gemini", "windsurf", "kiro"] },
      agentmemory: { enabled: true, namespace: "work" },
    },
  },
  {
    id: "personal",
    name: "personal",
    active: false,
    memoryNamespace: "personal",
    backends: {
      skillshare: { enabled: true, targets: ["claude", "gemini"] },
      agentmemory: { enabled: true, namespace: "personal" },
    },
  },
]

export const dryRunChanges = [
  { file: "~/.codex/config.toml", change: "mcp_servers.github.args  [-p, --flag-old] → [-p, --flag-new]" },
  { file: "~/.codex/config.toml", change: "mcp_servers.supabase  [v1.2.0] → [v1.4.1]" },
  { file: ".windsurf/skills/", change: "create symlink → ~/.config/skillshare/skills (6 items)" },
]
