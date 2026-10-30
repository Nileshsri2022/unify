import { describe, expect, test } from "bun:test"
import { agentmemoryArgv, agentmemoryEntryPath } from "./command"

/**
 * Windows regression: npm's `node_modules/.bin/agentmemory` is a POSIX shell
 * script there, so `Bun.spawn([cliPath])` throws "could not determine
 * executable" and `unify init` died at "ensuring memory server …".
 * Windows must run the package's JS entry through node instead.
 */
describe("agentmemoryArgv", () => {
  const cliPath = "C:\\Users\\niles\\.unify\\backends\\agentmemory\\node_modules\\.bin\\agentmemory"
  const entryPath = "C:\\Users\\niles\\.unify\\backends\\agentmemory\\node_modules\\@agentmemory\\agentmemory\\dist\\cli.mjs"

  test("win32 runs node + the JS entry, not the sh shim", () => {
    expect(agentmemoryArgv(cliPath, entryPath, "win32")).toEqual(["node", entryPath])
  })

  test("win32 without an entry falls back to the shim (no crash)", () => {
    expect(agentmemoryArgv(cliPath, undefined, "win32")).toEqual([cliPath])
  })

  test("posix keeps the npm shim even when an entry is known", () => {
    expect(agentmemoryArgv("/h/.unify/backends/agentmemory/node_modules/.bin/agentmemory", "/h/cli.mjs", "linux")).toEqual([
      "/h/.unify/backends/agentmemory/node_modules/.bin/agentmemory",
    ])
    expect(agentmemoryArgv("/cli", "/entry.mjs", "darwin")).toEqual(["/cli"])
  })
})

describe("agentmemoryEntryPath", () => {
  test("points at the package's dist entry under the unify home", () => {
    const p = agentmemoryEntryPath("/home/u/.unify")
    expect(p.endsWith("/@agentmemory/agentmemory/dist/cli.mjs")).toBe(true)
    expect(p.startsWith("/home/u/.unify/backends/agentmemory/node_modules/")).toBe(true)
  })
})
