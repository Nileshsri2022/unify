import { describe, expect, test } from "bun:test"
import path from "node:path"
import { agentmemoryArgv, agentmemoryComposeFile, agentmemoryComposeLog, agentmemoryDataDir, agentmemoryEntryPath } from "./command"

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

/**
 * agentmemory starts its engine through `iii compose`, and the project's real
 * failure ("PROJECT_DID_NOT_START", worker stderr) is only written to its
 * Compose daemon log. unify has to know where that is on each platform.
 */
describe("agentmemoryDataDir / compose paths", () => {
  test("win32: %APPDATA%\\agentmemory (as the package resolves it)", () => {
    const d = agentmemoryDataDir({
      home: "C:\\Users\\niles",
      env: { APPDATA: "C:\\Users\\niles\\AppData\\Roaming" },
      platform: "win32",
    })
    expect(d).toBe(path.join("C:\\Users\\niles\\AppData\\Roaming", "agentmemory"))
    expect(agentmemoryComposeLog({ home: "C:\\Users\\niles", env: { APPDATA: "C:\\Users\\niles\\AppData\\Roaming" }, platform: "win32" })).toBe(
      path.join(d, "compose", "compose-daemon.log"),
    )
    expect(agentmemoryComposeFile({ home: "C:\\Users\\niles", env: { APPDATA: "C:\\Users\\niles\\AppData\\Roaming" }, platform: "win32" })).toBe(
      path.join(d, "compose", "worker-compose.yaml"),
    )
  })

  test("win32 without APPDATA falls back to ~/.agentmemory", () => {
    expect(agentmemoryDataDir({ home: "C:\\Users\\n", env: {}, platform: "win32" })).toBe(
      path.join("C:\\Users\\n", ".agentmemory"),
    )
  })

  test("linux honours XDG_DATA_HOME, else ~/.local/share", () => {
    expect(agentmemoryDataDir({ home: "/home/u", env: { XDG_DATA_HOME: "/xdg" }, platform: "linux" })).toBe(
      path.join("/xdg", "agentmemory"),
    )
    expect(agentmemoryDataDir({ home: "/home/u", env: {}, platform: "linux" })).toBe(
      path.join("/home/u", ".local", "share", "agentmemory"),
    )
  })

  test("AGENTMEMORY_DATA_DIR wins, and --instance nests under it", () => {
    const env = { AGENTMEMORY_DATA_DIR: "/custom/data", APPDATA: "C:\\AppData" }
    expect(agentmemoryDataDir({ home: "/home/u", env, platform: "linux" })).toBe("/custom/data")
    expect(agentmemoryDataDir({ home: "/home/u", env, platform: "win32", instance: 2 })).toBe(
      path.join("/custom/data", "instance-2"),
    )
  })
})
