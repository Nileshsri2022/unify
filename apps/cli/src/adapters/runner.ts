export interface RunResult {
  code: number
  stdout: string
  stderr: string
}

/** Abstraction over command execution — tests inject a fixture-backed fake. */
export type Runner = (args: string[]) => Promise<RunResult>

/** Real runner: spawns the skillshare binary, captures stdout/stderr. */
export function realRunner(binPath: string): Runner {
  return async (args) => {
    const proc = Bun.spawn([binPath, ...args], {
      stdout: "pipe",
      stderr: "pipe",
    })
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ])
    const code = await proc.exited
    return { code, stdout, stderr }
  }
}
