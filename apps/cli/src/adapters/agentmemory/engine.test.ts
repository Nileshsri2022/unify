import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { BIN, makeTarGz, makeZip } from "../../../test/archives"
import {
  EngineError,
  III_RELEASE_SHA256,
  ensureEngine,
  engineBinName,
  engineInstallPath,
  iiiAssetFor,
  iiiReleaseUrl,
} from "./engine"

/**
 * agentmemory 0.9.31 refuses to install its iii-engine on Windows (needs
 * sh/curl/tar) and gives up on any .zip asset, so `unify init` there used to
 * hang for 180 s and dump its "Setup required" box. unify installs the engine
 * itself; these tests pin the tricky parts (asset naming, checksum enforcement,
 * zip vs tar.gz, the install location agentmemory actually reads).
 */

let root: string

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "unify-engine-"))
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex")

describe("iii asset naming (mirrors agentmemory)", () => {
  test("maps every supported platform/arch to the release asset name", () => {
    expect(iiiAssetFor("win32", "x64")).toBe("iii-x86_64-pc-windows-msvc.zip")
    expect(iiiAssetFor("win32", "arm64")).toBe("iii-aarch64-pc-windows-msvc.zip")
    expect(iiiAssetFor("linux", "x64")).toBe("iii-x86_64-unknown-linux-gnu.tar.gz")
    expect(iiiAssetFor("linux", "arm64")).toBe("iii-aarch64-unknown-linux-gnu.tar.gz")
    expect(iiiAssetFor("linux", "arm")).toBe("iii-armv7-unknown-linux-gnueabihf.tar.gz")
    expect(iiiAssetFor("darwin", "arm64")).toBe("iii-aarch64-apple-darwin.tar.gz")
    expect(iiiAssetFor("darwin", "x64")).toBe("iii-x86_64-apple-darwin.tar.gz")
  })

  test("unsupported targets return null instead of guessing", () => {
    expect(iiiAssetFor("freebsd", "x64")).toBeNull()
    expect(iiiAssetFor("win32", "ia32")).toBeNull()
  })

  test("binary name and install path match where agentmemory looks", () => {
    expect(engineBinName("win32")).toBe("iii.exe")
    expect(engineBinName("linux")).toBe("iii")
    expect(engineInstallPath("C:\\Users\\n", "win32")).toBe(
      path.join("C:\\Users\\n", ".agentmemory", "bin", "iii.exe"),
    )
    expect(engineInstallPath("/home/u", "linux")).toBe("/home/u/.agentmemory/bin/iii")
  })

  test("release URL is the pinned versioned asset", () => {
    expect(iiiReleaseUrl("iii-x86_64-pc-windows-msvc.zip")).toBe(
      "https://github.com/iii-hq/iii/releases/download/iii/v0.25.0/iii-x86_64-pc-windows-msvc.zip",
    )
  })

  test("the pin table covers agentmemory's checksums for v0.25.0", () => {
    const table = III_RELEASE_SHA256["0.25.0"]
    expect(Object.keys(table)).toHaveLength(7)
    expect(table["iii-x86_64-pc-windows-msvc.zip"]).toBe(
      "b80ea5c3408879380b6ce95f7b2855ce161d68642aeec8f7b54f104794cbb322",
    )
  })
})

describe("ensureEngine", () => {
  test("win32: downloads the .zip, verifies, extracts iii.exe to ~/.agentmemory/bin", async () => {
    const home = path.join(root, "win")
    const asset = "iii-x86_64-pc-windows-msvc.zip"
    const zip = makeZip([{ name: "iii.exe", data: BIN }])
    // mirrors the release layout the URL builder produces: <base>/iii/v<ver>/<asset>
    await mkdir(path.join(home, "iii", "v0.25.0"), { recursive: true })
    await writeFile(path.join(home, "iii", "v0.25.0", asset), zip)

    const r = await ensureEngine({
      home,
      platform: "win32",
      arch: "x64",
      releaseBase: `file://${home}`,
      checksums: { [asset]: sha(zip) },
    })
    expect(r.installed).toBe(true)
    expect(r.path).toBe(path.join(home, ".agentmemory", "bin", "iii.exe"))
    expect(existsSync(r.path)).toBe(true)
  })

  test("linux: tar.gz member extracts to the extensionless name", async () => {
    const home = path.join(root, "linux")
    const asset = "iii-x86_64-unknown-linux-gnu.tar.gz"
    const tgz = makeTarGz([{ name: "iii", data: BIN }])
    await mkdir(path.join(home, "iii", "v0.25.0"), { recursive: true })
    await writeFile(path.join(home, "iii", "v0.25.0", asset), tgz)

    const r = await ensureEngine({
      home,
      platform: "linux",
      arch: "x64",
      releaseBase: `file://${home}`,
      checksums: { [asset]: sha(tgz) },
    })
    expect(r.installed).toBe(true)
    expect(r.path).toBe("/" + path.join(home, ".agentmemory", "bin", "iii").replace(/^\/+/, ""))
  })

  test("already installed and runnable → no download", async () => {
    const home = path.join(root, "present")
    const dir = path.join(home, ".agentmemory", "bin")
    await mkdir(dir, { recursive: true })
    const bin = path.join(dir, "iii")
    await writeFile(bin, '#!/bin/sh\necho "iii 0.25.0"\n', { mode: 0o755 })
    if (process.platform === "win32") return // posix script only
    const r = await ensureEngine({ home, platform: "linux", arch: "x64" })
    expect(r.installed).toBe(false)
    expect(r.version).toContain("0.25.0")
  })

  test("checksum mismatch → EngineError('checksum'), nothing installed", async () => {
    const home = path.join(root, "bad-slash")
    const asset = "iii-x86_64-pc-windows-msvc.zip"
    await mkdir(path.join(home, "iii", "v0.25.0"), { recursive: true })
    await writeFile(path.join(home, "iii", "v0.25.0", asset), makeZip([{ name: "iii.exe", data: BIN }]))
    await expect(
      ensureEngine({
        home,
        platform: "win32",
        arch: "x64",
        releaseBase: `file://${home}`,
        checksums: { [asset]: "0".repeat(64) },
      }),
    ).rejects.toMatchObject({ code: "checksum" })
    expect(existsSync(path.join(home, ".agentmemory", "bin", "iii.exe"))).toBe(false)
  })

  test("unknown version → EngineError('no-checksum') rather than an unverified install", async () => {
    await expect(
      ensureEngine({ home: path.join(root, "v9"), platform: "win32", arch: "x64", version: "9.9.9" }),
    ).rejects.toMatchObject({ code: "no-checksum" })
  })

  test("unsupported platform → EngineError('unsupported-platform') with guidance", async () => {
    const err = await ensureEngine({ home: path.join(root, "bsd"), platform: "freebsd", arch: "x64" }).catch(
      (e) => e,
    )
    expect(err).toBeInstanceOf(EngineError)
    expect(err.code).toBe("unsupported-platform")
    expect(err.message).toContain("freebsd/x64")
  })

  test("archive without the binary → EngineError('extract') listing members", async () => {
    const home = path.join(root, "wrong-member")
    const asset = "iii-x86_64-pc-windows-msvc.zip"
    const zip = makeZip([{ name: "README.md", data: BIN }])
    await mkdir(path.join(home, "iii", "v0.25.0"), { recursive: true })
    await writeFile(path.join(home, "iii", "v0.25.0", asset), zip)
    const err = await ensureEngine({
      home,
      platform: "win32",
      arch: "x64",
      releaseBase: `file://${home}`,
      checksums: { [asset]: sha(zip) },
    }).catch((e) => e)
    expect(err.code).toBe("extract")
    expect(err.message).toContain("README.md")
  })

  test("HTTP error is reported as EngineError('download')", async () => {
    const err = await ensureEngine({
      home: path.join(root, "missing-asset"),
      platform: "win32",
      arch: "x64",
      releaseBase: `file://${path.join(root, "nope")}`,
      checksums: { "iii-x86_64-pc-windows-msvc.zip": "0".repeat(64) },
    }).catch((e) => e)
    expect(err).toBeInstanceOf(EngineError)
    expect(err.code).toBe("download")
  })
})
