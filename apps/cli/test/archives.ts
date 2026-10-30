import { deflateRawSync, gzipSync } from "node:zlib"

/**
 * Archive fixtures for tests — built in memory so no binaries live in the repo
 * and no `zip`/`tar` binaries are required on the test machine.
 */

export const enc = (s: string) => new TextEncoder().encode(s)

export const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(b: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

export interface Entry {
  name: string
  data: Uint8Array
  store?: boolean
}

/** Build a .zip (deflate unless `store`), including a leading directory entry. */
export function makeZip(entries: Entry[]): Uint8Array {
  const locals: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0

  for (const e of entries) {
    const nameBytes = enc(e.name)
    const body = e.store ? e.data : deflateRawSync(e.data)
    const method = e.store ? 0 : 8
    const crc = crc32(e.data)

    const local = new Uint8Array(30 + nameBytes.length + body.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(4, 20, true) // version needed
    lv.setUint16(6, 0, true) // flags
    lv.setUint16(8, method, true)
    lv.setUint32(14, crc, true)
    lv.setUint32(18, body.length, true)
    lv.setUint32(22, e.data.length, true)
    lv.setUint16(26, nameBytes.length, true)
    local.set(nameBytes, 30)
    local.set(body, 30 + nameBytes.length)
    locals.push(local)

    const cen = new Uint8Array(46 + nameBytes.length)
    const cv = new DataView(cen.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true)
    cv.setUint16(6, 20, true)
    cv.setUint16(8, 0, true)
    cv.setUint16(10, method, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, body.length, true)
    cv.setUint32(24, e.data.length, true)
    cv.setUint16(28, nameBytes.length, true)
    cv.setUint32(42, offset, true)
    cen.set(nameBytes, 46)
    central.push(cen)

    offset += local.length
  }

  const centralStart = offset
  const centralSize = central.reduce((n, c) => n + c.length, 0)
  const eocd = new Uint8Array(22)
  const ev = new DataView(eocd.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, entries.length, true)
  ev.setUint16(10, entries.length, true)
  ev.setUint32(12, centralSize, true)
  ev.setUint32(16, centralStart, true)

  const out = new Uint8Array(centralStart + centralSize + 22)
  let p = 0
  for (const part of [...locals, ...central, eocd]) {
    out.set(part, p)
    p += part.length
  }
  return out
}

/** Build a .tar.gz with plain ustar headers. */
export function makeTarGz(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const blocks: Uint8Array[] = []
  for (const f of files) {
    const header = new Uint8Array(512)
    header.set(enc(f.name).subarray(0, 100), 0)
    header.set(enc("0000644\0"), 100)
    header.set(enc("0000000\0"), 108)
    header.set(enc("0000000\0"), 116)
    header.set(enc(f.data.length.toString(8).padStart(11, "0") + "\0"), 124)
    header.set(enc("00000000000\0"), 136)
    header.set(enc("        "), 148) // checksum placeholder
    header[156] = 0x30 // regular file
    header.set(enc("ustar\0"), 257)
    header.set(enc("00"), 263)

    let sum = 0
    for (const b of header) sum += b
    header.set(enc(sum.toString(8).padStart(6, "0") + "\0 "), 148)

    blocks.push(header)
    blocks.push(f.data)
    const pad = (512 - (f.data.length % 512)) % 512
    if (pad) blocks.push(new Uint8Array(pad))
  }
  blocks.push(new Uint8Array(1024)) // two zero blocks = end

  const tar = new Uint8Array(blocks.reduce((n, b) => n + b.length, 0))
  let p = 0
  for (const b of blocks) {
    tar.set(b, p)
    p += b.length
  }
  return gzipSync(tar)
}

export const BIN = enc("#!/bin/sh\necho skillshare v0.28.0\n")
