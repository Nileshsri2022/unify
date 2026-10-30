import { describe, expect, test } from "bun:test"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { activeProfile, defaultConfig, defaultConfigForTools, loadUnify } from "./config"
import { readFile } from "node:fs/promises"

const OK = `
version: 1
profile: work
profiles:
  work:
    backends:
      skillshare: { enabled: true, targets: [claude, cursor] }
      agentmemory: { enabled: true, namespace: work }
glue:
  post-sync: [inject-agents-md-into-memory]
`

async function withHome(
  file: string | null,
  fn: (home: string) => Promise<void>,
): Promise<void> {
  const home = await mkdtempSafe()
  await mkdir(path.join(home, ".unify"), { recursive: true })
  if (file !== null) await writeFile(path.join(home, ".unify", "unify.yaml"), file, "utf8")
  try {
    await fn(home)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
}

async function mkdtempSafe(): Promise<string> {
  const { mkdtemp } = await import("node:fs/promises")
  return mkdtemp(path.join(tmpdir(), "unify-cfg-"))
}

describe("loadUnify", () => {
  test("parses a valid file", async () => {
    await withHome(OK, async (home) => {
      const { config, errors } = await loadUnify(home)
      expect(errors).toEqual([])
      expect(config).toBeDefined()
      expect(config!.profile).toBe("work")
      expect(config!.profiles.work.backends.skillshare.targets).toEqual([
        "claude",
        "cursor",
      ])
      expect(config!.profiles.work.backends.agentmemory.namespace).toBe("work")
      expect(config!.glue["post-sync"]).toEqual(["inject-agents-md-into-memory"])
    })
  })

  test("missing file → defaults, no throw, no errors", async () => {
    await withHome(null, async (home) => {
      const { config, errors } = await loadUnify(home)
      expect(errors).toEqual([])
      expect(config).toBeDefined()
      expect(config!.profile).toBe("work")
      expect(config!.profiles.work.backends.skillshare.enabled).toBe(true)
      expect(config!.profiles.work.backends.agentmemory.enabled).toBe(true)
    })
  })

  test("unknown profile reference → non-empty errors", async () => {
    await withHome(OK.replace("profile: work", "profile: missing"), async (home) => {
      const { errors } = await loadUnify(home)
      expect(errors.length).toBeGreaterThan(0)
      expect(errors.join(" ")).toContain("missing")
    })
  })

  test("invalid version → non-empty errors", async () => {
    await withHome(OK.replace("version: 1", "version: 99"), async (home) => {
      const { errors } = await loadUnify(home)
      expect(errors.length).toBeGreaterThan(0)
    })
  })
})

import { loadUnifyAt, writeUnify } from "./config"

describe("loadUnifyAt + writeUnify", () => {
  test("writeUnify then loadUnifyAt round-trips", async () => {
    const home = await mkdtempSafe()
    try {
      const dir = path.join(home, "unify-dir")
      const cfg = defaultConfigForTools(["claude", "cursor"])
      await writeUnify(cfg, dir)
      const { config, errors } = await loadUnifyAt(path.join(dir, "unify.yaml"))
      expect(errors).toEqual([])
      expect(config.version).toBe(1)
      expect(config.profile).toBe("work")
      expect(activeProfile(config).skillshare.targets).toEqual(["claude", "cursor"])
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  test("writeUnify is idempotent-safe: does not clobber existing file when skipExisting", async () => {
    const home = await mkdtempSafe()
    try {
      const dir = path.join(home, "d")
      await writeUnify(defaultConfig(), dir)
      const marker = path.join(dir, "unify.yaml")
      const first = await readFile(marker, "utf8")
      await writeUnify(defaultConfigForTools(["gemini"]), dir, { skipExisting: true })
      expect(await readFile(marker, "utf8")).toBe(first)
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  test("loadUnifyAt missing → defaults, no errors", async () => {
    const home = await mkdtempSafe()
    try {
      const { config, errors } = await loadUnifyAt(path.join(home, "nope.yaml"))
      expect(errors).toEqual([])
      expect(config.version).toBe(1)
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })
})
