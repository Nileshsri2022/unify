import { describe, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { findBun, findDashboardDir, resolveDistDir, resolveHost, resolvePort } from "./ui"

function fakeRepo(): string {
  const repo = mkdtempSync(path.join(tmpdir(), "unify-repo-"))
  mkdirSync(path.join(repo, "apps", "cli", "src", "commands"), { recursive: true })
  mkdirSync(path.join(repo, "apps", "cli", "dist"), { recursive: true })
  mkdirSync(path.join(repo, "apps", "dashboard"), { recursive: true })
  writeFileSync(path.join(repo, "apps", "dashboard", "package.json"), "{}")
  writeFileSync(path.join(repo, "apps", "cli", "dist", "unify"), "#!/bin/sh\n")
  return repo
}

describe("ui helpers", () => {
  test("resolvePort: flag > env > default 7420", () => {
    expect(resolvePort("8080", {})).toBe(8080)
    expect(resolvePort(undefined, { UNIFY_UI_PORT: "9000" })).toBe(9000)
    expect(resolvePort(undefined, {})).toBe(7420)
    expect(resolvePort("not-a-number", {})).toBe(7420)
    expect(resolvePort("70000", {})).toBe(7420)
    expect(resolvePort("0", {})).toBe(7420)
  })

  test("resolveHost: loopback by default, flag/env opt in to exposing it", () => {
    expect(resolveHost(undefined, {})).toBe("127.0.0.1")
    expect(resolveHost(undefined, { UNIFY_UI_HOST: "0.0.0.0" })).toBe("0.0.0.0")
    expect(resolveHost("0.0.0.0", {})).toBe("0.0.0.0")
    expect(resolveHost("192.168.1.9", { UNIFY_UI_HOST: "0.0.0.0" })).toBe("192.168.1.9")
    expect(resolveHost("  ", {})).toBe("127.0.0.1")
  })

  test("resolveDistDir: env override wins", () => {
    expect(resolveDistDir("/x/src", { UNIFY_UI_DIST: "/custom/dist" })).toBe("/custom/dist")
  })

  test("resolveDistDir: source mode (4 up from commands/)", () => {
    const repo = fakeRepo()
    const callerDir = path.join(repo, "apps", "cli", "src", "commands")
    expect(resolveDistDir(callerDir, {}, path.join(callerDir, "ui.ts"))).toBe(
      path.join(repo, "apps", "dashboard", "dist"),
    )
  })

  test("resolveDistDir: compiled binary (virtual callerDir, 3 up from binary)", () => {
    const repo = fakeRepo()
    const bin = path.join(repo, "apps", "cli", "dist", "unify")
    expect(resolveDistDir("/$bunfs/root", {}, bin)).toBe(path.join(repo, "apps", "dashboard", "dist"))
  })

  test("findDashboardDir: null when no repo layout (binary copied elsewhere)", () => {
    const elsewhere = mkdtempSync(path.join(tmpdir(), "unify-elsewhere-"))
    expect(findDashboardDir("/$bunfs/root", path.join(elsewhere, "unify"))).toBeNull()
  })

  test("findBun: execPath named bun wins without PATH lookup", () => {
    expect(findBun("/opt/homebrew/bin/bun")).toBe("/opt/homebrew/bin/bun")
  })
})
