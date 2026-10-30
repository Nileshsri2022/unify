import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { existsSync, statSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { makeZip } from "../../../test/archives"
import { realRunner } from "../runner"
import { resolveSkillshareBinary, skillshareBinName, SkillshareAdapter } from "./index"

/**
 * install() is tested against a local file:// asset (no network):
 * a tiny tarball containing a fake `skillshare` executable.
 */

let root: string
let home: string
let assetTarball: string
let assetZip: string
let goodSha: string
let zipSha: string

function fakeAdapter(): SkillshareAdapter {
  return new SkillshareAdapter({ runner: realRunner("true"), home })
}

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "unify-install-"))
  home = path.join(root, "home")
  const assetDir = path.join(root, "asset")
  await mkdir(assetDir, { recursive: true })
  const script = "#!/bin/sh\necho \"skillshare v0.28.0\"\n"
  await writeFile(path.join(assetDir, "skillshare"), script, { mode: 0o755 })

  assetTarball = path.join(root, "skillshare_0.28.0_linux_amd64.tar.gz")
  const p = Bun.spawn(["tar", "czf", assetTarball, "skillshare"], {
    cwd: assetDir,
    stdout: "ignore",
    stderr: "ignore",
  })
  expect(await p.exited).toBe(0)
  goodSha = createHash("sha256").update(await readFile(assetTarball)).digest("hex")

  // .zip release shape (what Windows ships) — member named per platform
  assetZip = path.join(root, "skillshare_0.28.0_windows_amd64.zip")
  await writeFile(
    assetZip,
    makeZip([
      { name: "README.md", data: new TextEncoder().encode("# skillshare") },
      { name: skillshareBinName(), data: new TextEncoder().encode("#!/bin/sh\necho \"skillshare v0.28.0\"\n") },
    ]),
  )
  zipSha = createHash("sha256").update(await readFile(assetZip)).digest("hex")
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

describe("SkillshareAdapter.install (local file:// asset, no network)", () => {
  test("ok path: downloads, verifies hash, extracts, executable, --version works", async () => {
    const a = fakeAdapter()
    await a.install({
      version: "0.28.0",
      sha256: goodSha,
      source: `file://${assetTarball}`,
    })
    const bin = path.join(home, ".unify", "backends", "skillshare", "skillshare")
    expect(existsSync(bin)).toBe(true)
    expect(statSync(bin).mode & 0o111).not.toBe(0)
    const r = await realRunner(bin)(["--version"])
    expect(r.code).toBe(0)
    expect(r.stdout).toContain("skillshare v0.28.0")
    // cached archive kept for reuse
    expect(existsSync(path.join(home, ".unify", "cache", "skillshare-0.28.0.tar.gz"))).toBe(true)
  })

  test("wrong hash: throws sha256 mismatch, no binary written", async () => {
    await rm(path.join(home, ".unify", "backends"), { recursive: true, force: true })
    const a = fakeAdapter()
    await expect(
      a.install({
        version: "0.28.0",
        sha256: "0".repeat(64),
        source: `file://${assetTarball}`,
      }),
    ).rejects.toThrow(/sha256 mismatch/)
    expect(existsSync(path.join(home, ".unify", "backends", "skillshare", "skillshare"))).toBe(false)
  })

  test("corrupt archive (valid hash, invalid tar): throws extract failed", async () => {
    const bad = path.join(root, "corrupt.tar.gz")
    await writeFile(bad, "this is not a gzip archive")
    const badSha = createHash("sha256").update(await readFile(bad)).digest("hex")
    const a = fakeAdapter()
    await expect(
      a.install({
        version: "0.28.0",
        sha256: badSha,
        source: `file://${bad}`,
      }),
    ).rejects.toThrow(/extract failed/)
  })

  test("404 source: throws download failed", async () => {
    const a = fakeAdapter()
    await expect(
      a.install({
        version: "0.28.0",
        sha256: goodSha,
        source: `file://${path.join(root, "missing.tar.gz")}`,
      }),
    ).rejects.toThrow(/download failed|HTTP/)
  })

  test("zip asset (the .zip release shape): extracts the member, no `unzip` binary involved", async () => {
    const a = fakeAdapter()
    await a.install({ version: "0.28.0", sha256: zipSha, source: `file://${assetZip}` })
    const bin = path.join(home, ".unify", "backends", "skillshare", skillshareBinName())
    expect(existsSync(bin)).toBe(true)
    const r = await realRunner(bin)(["--version"])
    expect(r.code).toBe(0)
    expect(r.stdout).toContain("skillshare v0.28.0")
    expect(existsSync(path.join(home, ".unify", "cache", "skillshare-0.28.0.zip"))).toBe(true)
  })

  test("win32 target: extracts `skillshare.exe` (the member Windows ships)", async () => {
    // start clean — earlier cases installed a posix-named binary here
    await rm(path.join(home, ".unify", "backends"), { recursive: true, force: true })
    const a = fakeAdapter()
    const winZip = path.join(root, "skillshare_0.28.0_windows_amd64.zip")
    await writeFile(
      winZip,
      makeZip([{ name: "skillshare.exe", data: new TextEncoder().encode("#!/bin/sh\necho \"skillshare v0.28.0\"\n") }]),
    )
    await a.install(
      {
        version: "0.28.0",
        sha256: createHash("sha256").update(await readFile(winZip)).digest("hex"),
        source: `file://${winZip}`,
      },
      "win32",
    )
    const exe = path.join(home, ".unify", "backends", "skillshare", "skillshare.exe")
    expect(existsSync(exe)).toBe(true)
    expect(existsSync(path.join(home, ".unify", "backends", "skillshare", "skillshare"))).toBe(false)
    // detection then finds it with the win32 naming rule
    expect(await resolveSkillshareBinary(path.join(home, ".unify"), undefined, "win32")).toBe(exe)
  })

  test("zip without the binary: throws extract failed and lists the members", async () => {
    const emptyZip = path.join(root, "empty.zip")
    await writeFile(emptyZip, makeZip([{ name: "LICENSE", data: new TextEncoder().encode("MIT") }]))
    const a = fakeAdapter()
    await expect(
      a.install({
        version: "0.28.0",
        sha256: createHash("sha256").update(await readFile(emptyZip)).digest("hex"),
        source: `file://${emptyZip}`,
      }),
    ).rejects.toThrow(/extract failed.*no member.*LICENSE/)
  })
})

describe("binary naming (Windows)", () => {
  test("skillshareBinName: .exe on win32 only", () => {
    expect(skillshareBinName("win32")).toBe("skillshare.exe")
    expect(skillshareBinName("linux")).toBe("skillshare")
    expect(skillshareBinName("darwin")).toBe("skillshare")
  })

  test("resolveSkillshareBinary finds the installed .exe on win32", async () => {
    const winHome = path.join(root, "win-unify-home")
    const dir = path.join(winHome, "backends", "skillshare")
    await mkdir(dir, { recursive: true })
    const exe = path.join(dir, "skillshare.exe")
    await writeFile(exe, "fake")
    expect(await resolveSkillshareBinary(winHome, undefined, "win32")).toBe(exe)
    // and the extensionless managed binary still wins on unix
    const unixHome = path.join(root, "unix-unify-home")
    await mkdir(path.join(unixHome, "backends", "skillshare"), { recursive: true })
    const bin = path.join(unixHome, "backends", "skillshare", "skillshare")
    await writeFile(bin, "fake")
    expect(await resolveSkillshareBinary(unixHome, undefined, "linux")).toBe(bin)
  })
})
