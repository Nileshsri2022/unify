import path from "node:path"
// The pin lives in index.ts (single source of truth for version + package).
import { AGENTMEMORY_NPM_PACKAGE } from "./index"

/**
 * How to launch the agentmemory CLI portably.
 *
 * npm's `node_modules/.bin/agentmemory` shim only works on POSIX: on Windows it
 * is a shell script that nothing in `Bun.spawn` can execute (the `.cmd` sibling
 * needs cmd.exe). The package does ship a real JS entry, so Windows runs
 * `node <entry>` and everything else keeps using the shim.
 */

/** The package's real CLI entry (e.g. …/node_modules/@agentmemory/agentmemory/dist/cli.mjs). */
export function agentmemoryEntryPath(unifyHome: string): string {
  return path.join(
    unifyHome,
    "backends",
    "agentmemory",
    "node_modules",
    AGENTMEMORY_NPM_PACKAGE,
    "dist",
    "cli.mjs",
  )
}

/**
 * argv prefix that runs the agentmemory CLI.
 * `entryPath` is only used on win32; POSIX keeps the npm shim (respects the
 * package's own shebang and any future launcher changes).
 */
export function agentmemoryArgv(
  cliPath: string,
  entryPath?: string,
  platform: NodeJS.Platform = process.platform,
): string[] {
  if (platform === "win32" && entryPath) return ["node", entryPath]
  return [cliPath]
}

/**
 * agentmemory's data directory, where it writes the Compose project it starts
 * alongside the engine. Mirrors resolveDataDir()/platformDefaultDataDir() in
 * @agentmemory/agentmemory@0.9.31: $AGENTMEMORY_DATA_DIR wins, then %APPDATA%,
 * then XDG_DATA_HOME / macOS Application Support.
 */
export function agentmemoryDataDir(opts: {
  home: string
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  instance?: number
}): string {
  const env = opts.env ?? process.env
  const platform = opts.platform ?? process.platform
  const fromEnv = env.AGENTMEMORY_DATA_DIR
  const base = (() => {
    if (fromEnv && path.isAbsolute(fromEnv)) return fromEnv
    if (platform === "win32") {
      return env.APPDATA ? path.join(env.APPDATA, "agentmemory") : path.join(opts.home, ".agentmemory")
    }
    if (platform === "darwin") {
      return path.join(opts.home, "Library", "Application Support", "agentmemory")
    }
    const xdg = env.XDG_DATA_HOME
    if (xdg && path.isAbsolute(xdg)) return path.join(xdg, "agentmemory")
    return path.join(opts.home, ".local", "share", "agentmemory")
  })()
  return opts.instance && opts.instance > 0 ? path.join(base, `instance-${opts.instance}`) : base
}

/**
 * The Compose daemon's own log. agentmemory starts the engine through
 * `iii compose` (workers state@0.22.20 + http@0.22.7 + the agentmemory worker),
 * and its failures ("did not start", worker stderr) only ever appear here —
 * agentmemory itself prints just "Compose exited with code 1".
 */
export function agentmemoryComposeLog(opts: Parameters<typeof agentmemoryDataDir>[0]): string {
  return path.join(agentmemoryDataDir(opts), "compose", "compose-daemon.log")
}

/** The generated Compose project (useful in messages). */
export function agentmemoryComposeFile(opts: Parameters<typeof agentmemoryDataDir>[0]): string {
  return path.join(agentmemoryDataDir(opts), "compose", "worker-compose.yaml")
}

/**
 * Where agentmemory keeps runtime metadata (engine-state.json, pid files):
 * $AGENTMEMORY_RUNTIME_DIR, else <home>/.agentmemory — mirrors
 * runtimeMetadataPath() in the package.
 */
export function agentmemoryRuntimeDir(opts: {
  home: string
  env?: NodeJS.ProcessEnv
}): string {
  const env = opts.env ?? process.env
  const dir = env.AGENTMEMORY_RUNTIME_DIR
  return dir && path.isAbsolute(dir) ? dir : path.join(opts.home, ".agentmemory")
}

/** agentmemory's own record of the running/attempted Compose engine. */
export function agentmemoryEngineStateFile(opts: { home: string; env?: NodeJS.ProcessEnv }): string {
  return path.join(agentmemoryRuntimeDir(opts), "engine-state.json")
}

/**
 * Candidate Compose daemon logs, most authoritative first.
 *
 * The daemon log is NOT in the compose/ project directory: agentmemory starts
 * `iii compose` with `logFile: ~/.agentmemory/compose-<restPort>.log`, and
 * records that path in engine-state.json (a previous guess at
 * `<dataDir>/compose/compose-daemon.log` does not exist on Windows — verified
 * on a real machine).
 */
export function agentmemoryComposeLogCandidates(opts: {
  home: string
  restPort: number
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
}): string[] {
  return [
    agentmemoryEngineStateFile(opts), // resolved to .logFile by the reader
    path.join(agentmemoryRuntimeDir(opts), `compose-${opts.restPort}.log`),
    path.join(agentmemoryDataDir(opts), "compose", "compose-daemon.log"),
  ]
}
