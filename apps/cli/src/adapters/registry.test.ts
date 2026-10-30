import { describe, expect, test } from "bun:test"
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { buildRegistry } from "./registry"
import { skillshareBinName } from "./skillshare"

/**
 * `unify init` installs the skillshare binary *after* the registry is built.
 * The registry used to bind the resolved path once, so the very next
 * detect() still ran the pre-install path and reported "not installed"
 * (on Windows that is exactly how init ended with "skillshare binary not
 * found"). Resolution is lazy now — this pins it.
 */
describe("buildRegistry: late-installed backend", () => {
  test.skipIf(process.platform === "win32")(
    "detect() picks up a binary that appears after the registry was built",
    async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), "unify-registry-"))
      const home = path.join(root, "home")
      const unifyHome = path.join(root, "unify")
      await mkdir(home, { recursive: true })
      await mkdir(unifyHome, { recursive: true })
      try {
        const reg = await buildRegistry(home, unifyHome)
        const sh = reg.get("skillshare")!
        expect((await sh.detect()).installed).toBe(false)

        const dir = path.join(unifyHome, "backends", "skillshare")
        await mkdir(dir, { recursive: true })
        const bin = path.join(dir, skillshareBinName())
        await writeFile(bin, '#!/bin/sh\necho "skillshare v0.28.0"\n')
        await chmod(bin, 0o755)

        const det = await sh.detect()
        expect(det.installed).toBe(true)
        expect(det.version).toBe("0.28.0")
        expect(det.path).toBe(bin)
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    },
  )

  test("install and detect agree on the state dir ($UNIFY_HOME)", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "unify-registry2-"))
    const home = path.join(root, "home")
    const unifyHome = path.join(root, "custom-unify")
    await mkdir(home, { recursive: true })
    await mkdir(unifyHome, { recursive: true })
    try {
      const reg = await buildRegistry(home, unifyHome)
      const sh = reg.get("skillshare")!
      // no ~/.unify fallback: the adapter must look under the injected state dir
      expect((await sh.detect()).installed).toBe(false)
      const dir = path.join(unifyHome, "backends", "skillshare")
      await mkdir(dir, { recursive: true })
      const bin = path.join(dir, skillshareBinName())
      await writeFile(bin, '#!/bin/sh\necho "skillshare v0.28.0"\n')
      await chmod(bin, 0o755)
      expect((await sh.detect()).path).toBe(bin)
      // and *not* under <home>/.unify
      expect(path.dirname(path.dirname(path.dirname(bin)))).toBe(unifyHome)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
