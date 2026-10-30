import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { watchHub } from "./watch"

let root: string

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "unify-hub-watch-"))
  await mkdir(path.join(root, "claude"), { recursive: true })
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

describe("hub watcher (detection only)", () => {
  test("reports the provider whose dir changed", async () => {
    const seen: string[] = []
    const w = watchHub(root, ["claude"], (p) => seen.push(p), 50)
    try {
      await writeFile(path.join(root, "claude", "note.txt"), "hi\n")
      await new Promise((r) => setTimeout(r, 600))
    } finally {
      w.close()
    }
    expect(seen).toContain("claude")
  }, 5000)
})
