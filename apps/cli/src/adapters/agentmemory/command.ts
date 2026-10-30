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
