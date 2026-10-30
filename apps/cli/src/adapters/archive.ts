import { gunzipSync, inflateRawSync } from "node:zlib"

/**
 * Minimal, dependency-free archive reader for pinned backend releases
 * (skillshare .tar.gz/.zip, iii-engine .tar.gz/.zip).
 *
 * `unzip` is not present on a stock Windows install and `tar` is not
 * guaranteed on slim containers, so extraction is done in-process with
 * node:zlib. Only what the releases actually contain is supported:
 * one regular file inside a deflate/stored .zip or a .tar.gz.
 */

export class ArchiveError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ArchiveError"
  }
}

export type ArchiveFormat = "zip" | "tar.gz"

const ZIP_EOCD = 0x06054b50
const ZIP_CENTRAL = 0x02014b50
const ZIP_LOCAL = 0x04034b50

/** Detect the container from magic bytes — never from the file extension. */
export function archiveFormat(buf: Uint8Array): ArchiveFormat {
  if (
    buf.length >= 4 &&
    buf[0] === 0x50 &&
    buf[1] === 0x4b &&
    (buf[2] === 0x03 || buf[2] === 0x05) &&
    (buf[3] === 0x04 || buf[3] === 0x06)
  ) {
    return "zip"
  }
  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) return "tar.gz"
  throw new ArchiveError("unrecognised archive format (expected .zip or .tar.gz)")
}

const u16 = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8)
const u32 = (b: Uint8Array, i: number) =>
  (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0

export interface ZipEntry {
  name: string
  method: number
  compSize: number
  uncompSize: number
  localOffset: number
}

function findEocd(buf: Uint8Array): number {
  // EOCD is 22 bytes + an optional comment (up to 65535)
  const stop = Math.max(0, buf.length - 0xffff - 22)
  for (let i = buf.length - 22; i >= stop; i--) {
    if (u32(buf, i) === ZIP_EOCD) return i
  }
  throw new ArchiveError("zip: end-of-central-directory record not found")
}

export function listZip(buf: Uint8Array): ZipEntry[] {
  const eocd = findEocd(buf)
  const count = u16(buf, eocd + 10)
  let p = u32(buf, eocd + 16)
  const entries: ZipEntry[] = []
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || u32(buf, p) !== ZIP_CENTRAL) {
      throw new ArchiveError("zip: corrupt central directory")
    }
    const entry: ZipEntry = {
      method: u16(buf, p + 10),
      compSize: u32(buf, p + 20),
      uncompSize: u32(buf, p + 24),
      localOffset: u32(buf, p + 42),
      name: "",
    }
    const nameLen = u16(buf, p + 28)
    const extraLen = u16(buf, p + 30)
    const commentLen = u16(buf, p + 32)
    entry.name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nameLen))
    if (
      entry.compSize === 0xffffffff ||
      entry.uncompSize === 0xffffffff ||
      entry.localOffset === 0xffffffff
    ) {
      throw new ArchiveError(`zip: ${entry.name} uses zip64, which is not supported`)
    }
    entries.push(entry)
    p += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

function pickEntry(entries: ZipEntry[], member: string, format: string): ZipEntry {
  const want = member.toLowerCase()
  const hit =
    entries.find((e) => e.name.toLowerCase() === want) ??
    entries.find((e) => e.name.toLowerCase().split("/").pop() === want)
  if (!hit) {
    const names = entries.map((e) => e.name).join(", ") || "none"
    throw new ArchiveError(`${format}: no member "${member}" (found: ${names})`)
  }
  return hit
}

export function readZipMember(buf: Uint8Array, member: string): Uint8Array {
  const e = pickEntry(listZip(buf), member, "zip")
  if (u32(buf, e.localOffset) !== ZIP_LOCAL) {
    throw new ArchiveError(`zip: corrupt local header for ${e.name}`)
  }
  const nameLen = u16(buf, e.localOffset + 26)
  const extraLen = u16(buf, e.localOffset + 28)
  const start = e.localOffset + 30 + nameLen + extraLen
  const raw = buf.subarray(start, start + e.compSize)
  if (e.method === 0) return raw // stored
  if (e.method === 8) return inflateRawSync(raw) // deflate
  throw new ArchiveError(`zip: unsupported compression method ${e.method} for ${e.name}`)
}

function cstr(buf: Uint8Array, start: number, len: number): string {
  let end = start
  while (end < start + len && buf[end] !== 0) end++
  return new TextDecoder().decode(buf.subarray(start, end))
}

function octal(buf: Uint8Array, start: number, len: number): number {
  const s = cstr(buf, start, len).trim()
  return s.length === 0 ? 0 : parseInt(s, 8) || 0
}

export function readTarGzMember(buf: Uint8Array, member: string): Uint8Array {
  let tar: Uint8Array
  try {
    tar = gunzipSync(buf)
  } catch (e) {
    throw new ArchiveError(`tar.gz: gunzip failed — ${e instanceof Error ? e.message : String(e)}`)
  }
  const want = member.toLowerCase()
  const seen: string[] = []
  let p = 0
  while (p + 512 <= tar.length) {
    let empty = true
    for (let i = p; i < p + 512; i++) {
      if (tar[i] !== 0) {
        empty = false
        break
      }
    }
    if (empty) break // end-of-archive marker

    const name = cstr(tar, p, 100)
    const prefix = cstr(tar, p + 345, 155)
    const full = prefix ? `${prefix}/${name}` : name
    const size = octal(tar, p + 124, 12)
    const type = String.fromCharCode(tar[p + 156] || 0x30)
    const dataStart = p + 512

    if ((type === "0" || type === "\0") && full) {
      seen.push(full)
      if (full.toLowerCase() === want || full.toLowerCase().split("/").pop() === want) {
        return tar.subarray(dataStart, dataStart + size)
      }
    }
    p = dataStart + Math.ceil(size / 512) * 512
  }
  const names = seen.join(", ") || "none"
  throw new ArchiveError(`tar.gz: no member "${member}" (found: ${names})`)
}

/** Read one member out of a .zip or .tar.gz buffer (format sniffed). */
export function readMember(buf: Uint8Array, member: string): Uint8Array {
  return archiveFormat(buf) === "zip" ? readZipMember(buf, member) : readTarGzMember(buf, member)
}
