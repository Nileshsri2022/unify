export interface RunResult {
  code: number
  stdout: string
  stderr: string
}

/** Abstraction over command execution — tests inject a fixture-backed fake. */
export type Runner = (args: string[]) => Promise<RunResult>

/** Shell convention for "command not found" / "not executable". */
export const RUNNER_EXEC_FAILED = 127

function describeSpawnError(binPath: string, e: unknown): string {
  const reason = e instanceof Error ? e.message : String(e)
  return `cannot execute "${binPath}": ${reason}`
}

/**
 * Real runner: spawns the skillshare binary, captures stdout/stderr.
 *
 * A missing binary is NOT exceptional — fresh machines have no skillshare
 * installed yet, and `detect()`/`status()` must report that as
 * `installed: false` instead of crashing the CLI/API. Spawn failures are
 * mapped to exit code 127 (shell "command not found") with the reason on
 * stderr, matching what a shell would do.
 */
export function realRunner(binPath: string): Runner {
  return async (args) => {
    let spawnError: unknown = null
    const proc = (() => {
      try {
        return Bun.spawn([binPath, ...args], { stdout: "pipe", stderr: "pipe" })
      } catch (e) {
        spawnError = e
        return null
      }
    })()
    if (!proc) {
      return { code: RUNNER_EXEC_FAILED, stdout: "", stderr: describeSpawnError(binPath, spawnError) }
    }
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ])
    const code = await proc.exited
    return { code, stdout, stderr }
  }
}
