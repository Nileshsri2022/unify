import { describe, expect, test } from "bun:test"
import {
  ArchiveError,
  archiveFormat,
  listZip,
  readMember,
  readTarGzMember,
  readZipMember,
} from "./archive"
import { BIN, enc, makeTarGz, makeZip } from "../../../test/archives"

/**
 * Extraction used to shell out to `unzip` / `tar`. Stock Windows has no
 * `unzip`, and its release asset is a .zip containing `skillshare.exe`, so
 * `unify init` installed nothing usable. These tests pin the in-process
 * reader against archives built here (no binaries in the repo).
 */

describe("archiveFormat", () => {
  test("sniffs zip, tar.gz, and rejects anything else", () => {
    expect(archiveFormat(makeZip([{ name: "a", data: BIN }]))).toBe("zip")
    expect(archiveFormat(makeTarGz([{ name: "a", data: BIN }]))).toBe("tar.gz")
    expect(() => archiveFormat(enc("not an archive"))).toThrow(ArchiveError)
  })
})

describe("zip", () => {
  test("reads a deflated member and finds it inside a directory", () => {
    const zip = makeZip([
      { name: "release/", data: new Uint8Array(0) },
      { name: "release/skillshare.exe", data: BIN },
      { name: "release/README.md", data: enc("# hi") },
    ])
    expect(new TextDecoder().decode(readZipMember(zip, "skillshare.exe"))).toBe(
      new TextDecoder().decode(BIN),
    )
  })

  test("reads a stored (uncompressed) member", () => {
    const zip = makeZip([{ name: "skillshare", data: BIN, store: true }])
    expect(new TextDecoder().decode(readZipMember(zip, "skillshare"))).toContain("skillshare v0.28.0")
  })

  test("name match is case-insensitive", () => {
    const zip = makeZip([{ name: "SkillShare.EXE", data: BIN }])
    expect(readZipMember(zip, "skillshare.exe").length).toBe(BIN.length)
  })

  test("missing member lists what is inside", () => {
    const zip = makeZip([{ name: "other.txt", data: enc("x") }])
    expect(() => readZipMember(zip, "skillshare")).toThrow(/no member "skillshare".*other\.txt/)
  })

  test("listZip reports every entry with its compression method", () => {
    const zip = makeZip([
      { name: "a.txt", data: enc("a") },
      { name: "b.txt", data: enc("b"), store: true },
    ])
    expect(listZip(zip).map((e) => [e.name, e.method])).toEqual([
      ["a.txt", 8],
      ["b.txt", 0],
    ])
  })

  test("truncated archive → clear error, no crash", () => {
    const zip = makeZip([{ name: "a", data: BIN }])
    expect(() => readZipMember(zip.subarray(0, zip.length - 30), "a")).toThrow(ArchiveError)
  })
})

describe("tar.gz", () => {
  test("reads the requested member out of a multi-file tarball", () => {
    const tgz = makeTarGz([
      { name: "README.md", data: enc("# skillshare") },
      { name: "skillshare", data: BIN },
    ])
    expect(new TextDecoder().decode(readTarGzMember(tgz, "skillshare"))).toContain(
      "skillshare v0.28.0",
    )
  })

  test("missing member lists what is inside", () => {
    const tgz = makeTarGz([{ name: "README.md", data: enc("# hi") }])
    expect(() => readTarGzMember(tgz, "skillshare")).toThrow(/no member "skillshare".*README\.md/)
  })

  test("corrupt gzip → clear error", () => {
    expect(() => readTarGzMember(enc("\x1f\x8bnot really gzip"), "skillshare")).toThrow(
      /gunzip failed/,
    )
  })
})

describe("readMember", () => {
  test("dispatches on magic bytes, not on the file name", () => {
    const zip = makeZip([{ name: "skillshare", data: BIN }])
    const tgz = makeTarGz([{ name: "skillshare", data: BIN }])
    const want = new TextDecoder().decode(BIN)
    expect(new TextDecoder().decode(readMember(zip, "skillshare"))).toBe(want)
    expect(new TextDecoder().decode(readMember(tgz, "skillshare"))).toBe(want)
  })
})
