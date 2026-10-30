import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

/**
 * e2e: `unify profile` — show + switch. No backends involved: the command
 * only reads/rewrites unify.yaml (switchProfile in @unify/core).
 */

let root: string
let home: string
let unifyHome: string
let cliEntry: string

async function run(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const p = Bun.spawn(["bun", cliEntry, ...args], {
    cwd: home,
    env: { ...process.env, HOME: home, UNIFY_HOME: unifyHome },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  const code = await p.exited
  return { code, stdout: await new Response(p.stdout).text(), stderr: await new Response(p.stderr).text() }
}

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "unify-profile-e2e-"))
  home = path.join(root, "home")
  unifyHome = path.join(root, "unify")
  cliEntry = new URL("../index.ts", import.meta.url).pathname
  await mkdir(home, { recursive: true })
  await mkdir(unifyHome, { recursive: true })
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

describe("e2e: unify profile (show + switch)", () => {
  test("no arg: shows the active profile (defaults → work)", async () => {
    const r = await run(["profile"])
    expect(r.code).toBe(0)
    expect(r.stdout).toContain("active profile: work")
    expect(r.stdout).toContain("namespace work")
  })

  test("switch to personal: yaml rewritten, flip summary printed", async () => {
    const r = await run(["profile", "personal"])
    expect(r.code).toBe(0)
    expect(r.stdout).toContain("profile switched: work → personal")
    expect(r.stdout).toContain("namespace personal")
    const yaml = await readFile(path.join(unifyHome, "unify.yaml"), "utf8")
    expect(yaml).toContain("profile: personal")
  })

  test("after switch: no-arg shows personal", async () => {
    const r = await run(["profile"])
    expect(r.stdout).toContain("active profile: personal")
  })

  test("unknown profile → exit 1, lists available profiles", async () => {
    const r = await run(["profile", "nope"])
    expect(r.code).toBe(1)
    expect(r.stderr).toContain("nope")
    expect(r.stderr).toContain("work")
    expect(r.stderr).toContain("personal")
  })

  test("switch back to work", async () => {
    const r = await run(["profile", "work"])
    expect(r.code).toBe(0)
    expect(r.stdout).toContain("profile switched: personal → work")
  })

  test("switch on a config with an explicit personal target set reports the flip", async () => {
    const yaml = [
      "version: 1",
      "profile: work",
      "profiles:",
      "  work:",
      "    backends:",
      "      skillshare: { enabled: true, targets: [claude] }",
      "      agentmemory: { enabled: true, namespace: work }",
      "  personal:",
      "    backends:",
      "      skillshare: { enabled: true, targets: [gemini, cursor] }",
      "      agentmemory: { enabled: true, namespace: personal }",
      "",
    ].join("\n")
    await writeFile(path.join(unifyHome, "unify.yaml"), yaml)
    const r = await run(["profile", "personal"])
    expect(r.code).toBe(0)
    expect(r.stdout).toContain("gemini, cursor")
    expect(r.stdout).toContain("namespace personal")
  })
})
