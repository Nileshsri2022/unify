import { describe, expect, test } from "bun:test"
import path from "node:path"
import { agentmemoryArgv, agentmemoryEntryPath } from "./command"

/**
 * Windows regression: npm's `node_modules/.bin/agentmemory` is a POSIX shell
 * script there, so `Bun.spawn([cliPath])` throws "could not determine
 * executable" and `unify init` died at "ensuring memory server …".
 * Windows must run the package's JS entry through node instead.
 *
 * These tests run on windows-latest in CI, so nothing may assume a POSIX
 * separator or a POSIX root — expectations are built with `path.join`.
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
    const shim = "/h/.unify/backends/agentmemory/node_modules/.bin/agentmemory"
    expect(agentmemoryArgv(shim, "/h/cli.mjs", "linux")).toEqual([shim])
    expect(agentmemoryArgv("/cli", "/entry.mjs", "darwin")).toEqual(["/cli"])
  })
})

describe("agentmemoryEntryPath", () => {
  test("points at the package's dist entry, under the given unify home", () => {
    const home = path.resolve("tmp", "unify-home")
    const expected = path.join(
      home,
      "backends",
      "agentmemory",
      "node_modules",
      "@agentmemory",
      "agentmemory",
      "dist",
      "cli.mjs",
    )
    expect(agentmemoryEntryPath(home)).toBe(expected)
  })

  test("honours a custom $UNIFY_HOME location", () => {
    const home = path.resolve("elsewhere", "state")
    const got = agentmemoryEntryPath(home)
    // compare path segments so the assertion holds on win32 and posix alike
    expect(got.split(/[\\/]/).slice(-4)).toEqual([
      "@agentmemory",
      "agentmemory",
      "dist",
      "cli.mjs",
    ])
    expect(got.startsWith(home)).toBe(true)
  })
})
