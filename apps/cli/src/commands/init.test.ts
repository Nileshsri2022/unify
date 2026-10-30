import { describe, expect, test } from "bun:test"
import { attemptInstall, memoryStartHints, skillshareInstallHints } from "./init"

/**
 * `unify init` is the first command a new user runs. A failed backend install
 * must be reported, not thrown: an escaping error gets citty's top-level
 * handler to dump a Bun stack trace at the user ("ERROR download failed … at
 * install (/$bunfs/root/unify:13629)"), which tells them nothing actionable.
 */
describe("attemptInstall", () => {
  test("success → ok, nothing logged", async () => {
    const lines: string[] = []
    const r = await attemptInstall("skillshare", async () => {}, (l) => lines.push(l))
    expect(r).toEqual({ ok: true })
    expect(lines).toEqual([])
  })

  test("failure → {ok:false,error}, logged once, never thrown", async () => {
    const lines: string[] = []
    const r = await attemptInstall(
      "skillshare",
      async () => {
        throw new Error("download failed: unable to verify the first certificate")
      },
      (l) => lines.push(l),
    )
    expect(r).toEqual({
      ok: false,
      error: "download failed: unable to verify the first certificate",
    })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain("unify init: skillshare install failed")
    expect(lines[0]).toContain("unable to verify the first certificate")
    expect(lines[0]).not.toContain("at install (") // no stack frames
  })

  test("non-Error throws are stringified", async () => {
    const lines: string[] = []
    const r = await attemptInstall("agentmemory", async () => {
      throw "npm exploded"
    }, (l) => lines.push(l))
    expect(r).toEqual({ ok: false, error: "npm exploded" })
    expect(lines[0]).toContain("agentmemory install failed — npm exploded")
  })
})

describe("skillshareInstallHints", () => {
  test("names the pinned asset + sha and the final step", () => {
    const hints = skillshareInstallHints("https://example.test/skillshare.tar.gz", "abc123")
    const text = hints.join("\n")
    expect(text).toContain("https://example.test/skillshare.tar.gz")
    expect(text).toContain("abc123")
    expect(text).toContain("~/.unify/backends/skillshare/skillshare")
    expect(hints.at(-1)).toContain("unify init")
  })

  test("still actionable without a manifest (platform has no pinned asset)", () => {
    const hints = skillshareInstallHints()
    expect(hints.join("\n")).toContain("github.com release assets")
    expect(hints.at(-1)).toContain("unify init")
  })
})

describe("memoryStartHints", () => {
  // the caller prints the cause (one line) itself — hints must not repeat it
  test("points at the engine path and at the log tail", () => {
    const hints = memoryStartHints(
      "iii-engine is required by agentmemory but could not be installed: SHA-256 mismatch for iii-x86_64-pc-windows-msvc.zip: expected b80…, got 123…\nLog tail:\nSetup required\nInstall iii-engine",
      "C:\\Users\\niles\\.agentmemory\\bin\\iii.exe",
    )
    const text = hints.join("\n")
    expect(text).toContain("C:\\Users\\niles\\.agentmemory\\bin\\iii.exe")
    expect(text).toContain("last log lines")
    expect(text).toContain("skills still sync")
    // no duplicated cause line, no multi-line dump inside one hint
    expect(text).not.toContain("cause:")
    expect(hints.every((h) => !h.startsWith("iii-engine is required"))).toBe(true)
  })

  test("works for a plain supervisor failure", () => {
    const hints = memoryStartHints("agentmemory exited before it was ready (exit 1).", "/h/.agentmemory/bin/iii")
    expect(hints.join("\n")).toContain("memory is unavailable until this is fixed")
  })
})
