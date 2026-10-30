import { describe, expect, test } from "bun:test"
import type { HealthIssue, UnifiedStatus } from "@unify/core"
import { renderDoctor, renderStatus, renderSync, type LastSyncEntry } from "./state-io"

const status: UnifiedStatus = {
  profile: "work",
  backends: [
    {
      id: "skillshare",
      installed: true,
      version: "0.28.0",
      pinnedVersion: "0.28.0",
      healthy: false,
      issues: [
        { severity: "warn", backend: "skillshare", message: "universal: 1 source skill(s) not linked", fix: "unify sync" },
      ],
    },
  ],
  targets: [
    { target: "claude", tool: "claude", state: "in-sync", detail: "2 skill(s) linked" },
    { target: "universal", tool: "universal", state: "drift", detail: "1 skill(s) not linked: skillshare" },
    { target: "cursor", tool: "cursor", state: "missing", detail: "installed on machine, not a skillshare target" },
    { target: "codex", tool: "codex", state: "not-installed" },
  ],
  memory: { namespaces: [], total: 0 },
  generatedAt: "2026-10-30T00:00:00.000Z",
}

const lastSync: LastSyncEntry = {
  at: "2026-10-30T12:00:00.000Z",
  backend: "skillshare",
  dryRun: false,
  changes: [],
}

describe("renderStatus (golden)", () => {
  test("exact table with last sync", () => {
    const out = renderStatus(status, lastSync, "7 entries (agentmemory v0.9.31)")
    expect(out).toBe(
      [
        "unify — status (profile: work)",
        "",
        "BACKEND      VERSION   PINNED    HEALTH",
        "skillshare   0.28.0    0.28.0    1 issue(s)",
        "",
        "TARGET       STATE          DETAIL",
        "claude       in-sync       2 skill(s) linked",
        "universal    drift         1 skill(s) not linked: skillshare",
        "cursor       missing       installed on machine, not a skillshare target",
        "codex        not-installed",
        "",
        "Memory: 7 entries (agentmemory v0.9.31)",
        "Last sync: 2026-10-30T12:00:00.000Z",
      ].join("\n"),
    )
  })

  test("never-synced + not installed backend", () => {
    const out = renderStatus(
      {
        ...status,
        backends: [
          { id: "skillshare", installed: false, healthy: false, issues: [{ severity: "error", backend: "skillshare", message: "skillshare not installed", fix: "unify init" }] },
        ],
        targets: [],
      },
      null,
      "not installed (fix: unify init)",
    )
    expect(out).toBe(
      [
        "unify — status (profile: work)",
        "",
        "BACKEND      VERSION   PINNED    HEALTH",
        "skillshare   -         -         not-installed",
        "",
        "TARGET       STATE          DETAIL",
        "",
        "Memory: not installed (fix: unify init)",
        "Last sync: never",
      ].join("\n"),
    )
  })
})

describe("renderSync (golden)", () => {
  test("dry-run table", () => {
    const out = renderSync(
      {
        backend: "skillshare",
        dryRun: true,
        changes: [
          { target: "claude", action: "2 linked, 0 updated, 0 pruned" },
          { target: "gemini", action: "2 linked, 0 updated, 0 pruned" },
        ],
      },
      [
        { target: "claude", action: "2 linked, 0 updated, 0 pruned" },
        { target: "gemini", action: "2 linked, 0 updated, 0 pruned" },
      ],
    )
    expect(out).toBe(
      [
        "skillshare sync (dry-run)",
        "claude       2 linked, 0 updated, 0 pruned",
        "gemini       2 linked, 0 updated, 0 pruned",
      ].join("\n"),
    )
  })

  test("error line", () => {
    const out = renderSync({ backend: "skillshare", dryRun: false, changes: [], error: "boom" }, [])
    expect(out).toBe("skillshare sync\nerror: boom")
  })
})

describe("renderDoctor (golden)", () => {
  const issues: HealthIssue[] = [
    { severity: "warn", backend: "skillshare", message: "version 9.9.9 != pinned 0.28.0", fix: "unify backends update" },
    { severity: "error", backend: "config", message: "unknown profile" },
  ]
  test("issue list", () => {
    expect(renderDoctor(issues)).toBe(
      [
        "WARN  [skillshare] version 9.9.9 != pinned 0.28.0 (fix: unify backends update)",
        "ERROR [config] unknown profile",
      ].join("\n"),
    )
  })
  test("clean", () => {
    expect(renderDoctor([])).toBe("doctor: all checks passed")
  })
})
