import { describe, expect, test } from "bun:test"
import { RUNNER_EXEC_FAILED, realRunner } from "./runner"

describe("realRunner", () => {
  test("runs a real command and captures stdout + exit code", async () => {
    const r = await realRunner("echo")(["hello"])
    expect(r.code).toBe(0)
    expect(r.stdout.trim()).toBe("hello")
  })

  test("non-zero exit is reported, not thrown", async () => {
    const r = await realRunner("sh")(["-c", "echo nope >&2; exit 3"])
    expect(r.code).toBe(3)
    expect(r.stderr.trim()).toBe("nope")
  })

  test("missing binary on PATH → exit 127 with a readable reason (no throw)", async () => {
    const r = await realRunner("unify-definitely-not-a-binary")(["--version"])
    expect(r.code).toBe(RUNNER_EXEC_FAILED)
    expect(r.stdout).toBe("")
    expect(r.stderr).toContain("unify-definitely-not-a-binary")
  })

  test("missing absolute path → exit 127 (no throw)", async () => {
    const r = await realRunner("/nonexistent/unify/skillshare")(["--version"])
    expect(r.code).toBe(RUNNER_EXEC_FAILED)
    expect(r.stderr).toContain("/nonexistent/unify/skillshare")
  })
})
