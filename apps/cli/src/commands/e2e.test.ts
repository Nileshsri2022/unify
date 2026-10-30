import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

/**
 * Scripted e2e: a stub `skillshare` bash script on PATH emits the recorded
 * v0.28.0 fixtures, runs against an isolated HOME + UNIFY_HOME. The real CLI
 * entry point is executed as a child `bun` process.
 */

let root: string
let fakeHome: string
let unifyHome: string
let stubDir: string
let callLog: string
let cliEntry: string
let fixturesDir: string


async function run(args: string[], stdin?: string): Promise<{ code: number; stdout: string; stderr: string }> {
  const p = Bun.spawn(["bun", cliEntry, ...args], {
    cwd: fakeHome,
    env: {
      ...process.env,
      HOME: fakeHome,
      UNIFY_HOME: unifyHome,
      PATH: `${stubDir}:${process.env.PATH ?? ""}`,
      SH_FIXTURES: fixturesDir,
      SH_CALL_LOG: callLog,
    },
    stdin: stdin === undefined ? "ignore" : "pipe",
    stdout: "pipe",
    stderr: "pipe",
  })
  if (stdin !== undefined && p.stdin) {
    p.stdin.write(stdin)
    p.stdin.end()
  }
  const code = await p.exited
  const stdout = await new Response(p.stdout).text()
  const stderr = await new Response(p.stderr).text()
  return { code, stdout, stderr }
}

async function readCalls(): Promise<string[]> {
  try {
    const t = await readFile(callLog, "utf8")
    return t.trim().split("\n")
  } catch {
    return []
  }
}

/** Fake user home with claude + gemini installed, universal drifted. */
async function buildFakeHome(): Promise<void> {
  const src = path.join(fakeHome, ".config", "skillshare", "skills")
  for (const s of ["code-review", "skillshare"]) {
    await mkdir(path.join(src, s), { recursive: true })
    await writeFile(path.join(src, s, "SKILL.md"), `---\nname: ${s}\n---\n`)
  }
  for (const d of [
    ".claude/skills/code-review",
    ".claude/skills/skillshare",
    ".gemini/skills/code-review",
    ".gemini/skills/skillshare",
    ".agents/skills/code-review", // universal missing `skillshare` → drift
  ]) {
    await mkdir(path.join(fakeHome, d), { recursive: true })
  }
}

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "unify-e2e-"))
  fakeHome = path.join(root, "home")
  unifyHome = path.join(root, "unify")
  stubDir = path.join(root, "bin")
  callLog = path.join(root, "calls.log")
  cliEntry = new URL("../index.ts", import.meta.url).pathname
  fixturesDir = new URL("../../testdata/skillshare/0.28.0", import.meta.url).pathname

  await mkdir(fakeHome, { recursive: true })
  await mkdir(unifyHome, { recursive: true })
  await mkdir(stubDir, { recursive: true })

  const stub = `#!/usr/bin/env bash
echo "$*" >> "$SH_CALL_LOG"
case "$*" in
  "--version") cat "$SH_FIXTURES/version.out" ;;
  "target list") cat "$SH_FIXTURES/target-list.out" ;;
  "sync --dry-run --json") cat "$SH_FIXTURES/sync-dryrun.json" ;;
  "sync --json") cat "$SH_FIXTURES/sync-apply.json" ;;
  "init --no-copy --all-targets") mkdir -p "$HOME/.config/skillshare"; touch "$HOME/.config/skillshare/config.yaml"; echo "✓ initialized" ;;
  "target add"*) echo "✓ Added target" ;;
  *) echo "stub: unhandled: $*" >&2; exit 1 ;;
esac
`
  await writeFile(path.join(stubDir, "skillshare"), stub, { mode: 0o755 })
  await buildFakeHome()
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

describe("e2e: unify status (stub skillshare)", () => {
  test("prints the exact status table, exit 0", async () => {
    const { code, stdout } = await run(["status"])
    expect(code).toBe(0)
    expect(stdout).toBe(
      [
        "unify — status (profile: work)",
        "",
        "BACKEND      VERSION   PINNED    HEALTH",
        "skillshare   0.28.0    0.28.0    1 issue(s)",
        "agentmemory  -         -         not-installed",
        "",
        "TARGET       STATE          DETAIL",
        "claude       in-sync       2 skill(s) linked",
        "gemini       in-sync       2 skill(s) linked",
        "universal    drift         1 skill(s) not linked: skillshare",
        "codex        not-installed",
        "cursor       not-installed",
        "windsurf     not-installed",
        "opencode     not-installed",
        "goose        not-installed",
        "copilot      not-installed",
        "cline        not-installed",
        "zed          not-installed",
        "",
        "Memory: not installed (fix: unify init)",
        "Last sync: never",
      ].join("\n") + "\n",
    )
  })

  test("status --json has the UnifiedStatus shape", async () => {
    const { code, stdout } = await run(["status", "--json"])
    expect(code).toBe(0)
    const j = JSON.parse(stdout)
    expect(j.profile).toBe("work")
    expect(j.backends).toHaveLength(2)
    expect(j.backends.map((b: { id: string }) => b.id)).toEqual(["skillshare", "agentmemory"])
    expect(j.backends[0].version).toBe("0.28.0")
    expect(j.memory).toEqual({ namespaces: [], total: 0 })
    expect(j.targets.every((t: { target: string; state: string }) => typeof t.target === "string" && typeof t.state === "string")).toBe(true)
    expect(typeof j.memory.total).toBe("number")
    expect(typeof j.generatedAt).toBe("string")
  })
})

describe("e2e: unify doctor (stub skillshare)", () => {
  test("flags a stale backends.lock.json", async () => {
    const lockPath = path.join(unifyHome, "backends.lock.json")
    await writeFile(
      lockPath,
      JSON.stringify({ skillshare: { version: "0.27.0", sha256: "x", source: "github-release" } }),
      "utf8",
    )
    const { code, stdout } = await run(["doctor"])
    // agentmemory is not installed in this stub env → doctor must fail loud
    expect(code).toBe(1)
    expect(stdout).toContain("agentmemory not installed")
    expect(stdout).toContain("fix: unify init")
    expect(stdout).toContain("lock 0.27.0 != installed 0.28.0")
    await rm(lockPath, { force: true })
  })

  test("glue enabled but AGENTS.md missing → WARN (glue radar)", async () => {
    const cfgPath = path.join(unifyHome, "unify.yaml")
    const saved = await readFile(cfgPath, "utf8").catch(() => null)
    await writeFile(
      cfgPath,
      [
        "version: 1",
        "profile: work",
        "profiles:",
        "  work:",
        "    backends:",
        "      skillshare: { enabled: true, targets: [claude] }",
        "      agentmemory: { enabled: true, namespace: work }",
        "glue:",
        "  post-sync: [inject-agents-md-into-memory]",
        "",
      ].join("\n"),
    )
    await rm(path.join(unifyHome, "AGENTS.md"), { force: true })
    const { code, stdout } = await run(["doctor"])
    expect(stdout).toContain("AGENTS.md not found")
    expect(stdout).toContain("fix: ")
    expect(stdout).toContain("AGENTS.md")
    // glue warn is a warn, not an error — but agentmemory-not-installed is an error
    expect(code).toBe(1)
    if (saved !== null) await writeFile(cfgPath, saved)
    else await rm(cfgPath, { force: true })
  })
})

describe("e2e: unify sync --dry-run (stub skillshare)", () => {
  test("prints the exact dry-run table, writes nothing", async () => {
    const before = await readCalls()
    const { code, stdout } = await run(["sync", "--dry-run"])
    expect(code).toBe(0)
    expect(stdout).toBe(
      [
        "skillshare sync (dry-run)",
        "claude       2 linked, 0 updated, 0 pruned",
        "gemini       2 linked, 0 updated, 0 pruned",
        "universal    2 linked, 0 updated, 0 pruned",
      ].join("\n") + "\n",
    )
    const after = await readCalls()
    expect(after.slice(before.length)).toEqual(["sync --dry-run --json"])
    const last = path.join(unifyHome, "state", "last-sync.json")
    let exists = true
    try {
      await readFile(last)
    } catch {
      exists = false
    }
    expect(exists).toBe(false)
  })
})

describe("e2e: unify init --yes (stub skillshare)", () => {
  test("detects tools, inits skillshare, applies first sync", async () => {
    // fresh unify home state for a deterministic init
    await rm(path.join(unifyHome, "unify.yaml"), { force: true })
    await rm(path.join(unifyHome, "state"), { recursive: true, force: true })
    await rm(path.join(fakeHome, ".config", "skillshare"), { recursive: true, force: true })
    // pre-seed config with agentmemory disabled (stub env: no npm install allowed)
    await writeFile(
      path.join(unifyHome, "unify.yaml"),
      [
        "version: 1",
        "profile: work",
        "profiles:",
        "  work:",
        "    backends:",
        "      skillshare:",
        "        enabled: true",
        "        targets:",
        "          - claude",
        "          - gemini",
        "          - universal",
        "      agentmemory:",
        "        enabled: false",
        "",
      ].join("\n"),
    )

    const { code, stdout } = await run(["init", "--yes"])
    expect(code).toBe(0)

    const cfg = await readFile(path.join(unifyHome, "unify.yaml"), "utf8")
    expect(cfg).toContain("profile: work")
    expect(cfg).toContain("claude")
    expect(cfg).toContain("gemini")
    expect(cfg).toContain("enabled: false")

    const calls = await readCalls()
    expect(calls).toContain("init --no-copy --all-targets")
    expect(calls).toContain("sync --dry-run --json")
    expect(calls[calls.length - 1]).toBe("sync --json")

    const last = JSON.parse(await readFile(path.join(unifyHome, "state", "last-sync.json"), "utf8"))
    expect(last.dryRun).toBe(false)
    expect(last.backend).toBe("skillshare")

    expect(stdout).toContain("Detected AI tools: claude, gemini")
    expect(stdout).toContain("skillshare initialized")
    expect(stdout).toContain("Done. Run `unify status` to verify.")
  })

  test("second init does not clobber unify.yaml", async () => {
    const first = await readFile(path.join(unifyHome, "unify.yaml"), "utf8")
    // remove gemini so detection would want different targets
    await rm(path.join(fakeHome, ".gemini"), { recursive: true, force: true })
    await run(["init", "--yes"])
    const second = await readFile(path.join(unifyHome, "unify.yaml"), "utf8")
    expect(second).toBe(first)
  })
})
