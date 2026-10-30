import { existsSync } from "node:fs"
import path from "node:path"
import { defineCommand, type ArgsDef } from "citty"
import { loadUnifyAt } from "@unify/core"
import { createApiHandler } from "../ui/server"

/**
 * unify ui — serve the dashboard + JSON API on one local port (127.0.0.1).
 *
 *   unify ui                 # default port 7420 (or $UNIFY_UI_PORT)
 *   unify ui --port 8080
 *   unify ui --api-only      # skip static serving (vite dev workflow)
 *
 * Works from source (`bun apps/cli/src/index.ts ui`) and from the compiled
 * binary (`apps/cli/dist/unify ui` — import.meta.dir is virtual there, so the
 * dashboard is located relative to the binary).
 *
 * Exit: 0 on Ctrl-C / SIGTERM.
 */
const uiArgs: ArgsDef = {
  port: {
    type: "string",
    description: "Port to bind (default 7420, or $UNIFY_UI_PORT)",
    required: false,
  },
  "api-only": {
    type: "boolean",
    description: "API only — no static dashboard (pair with `vite dev`)",
    required: false,
  },
}

export const uiCommand = defineCommand({
  meta: { name: "ui", description: "Serve the dashboard + JSON API on one local port" },
  args: uiArgs,
  async run({ args }) {
    const exit = await runUi(args as Record<string, unknown>)
    if (exit !== undefined) process.exitCode = exit
  },
})

/**
 * Locate the dashboard source dir in both run modes:
 * - source: callerDir = <repo>/apps/cli/src/commands (4 up → repo root)
 * - compiled binary: execPath = <repo>/apps/cli/dist/unify (3 up → repo root)
 * Returns null when the repo layout is not present (e.g. binary copied
 * elsewhere) — the caller should require $UNIFY_UI_DIST.
 */
export function findDashboardDir(
  callerDir: string,
  execPath: string,
  isVirtualDir: (d: string) => boolean = (d) => d.startsWith("/$bunfs"),
): string | null {
  const candidates: string[] = []
  if (!isVirtualDir(callerDir)) {
    candidates.push(path.resolve(callerDir, "../../../../apps/dashboard"))
  }
  candidates.push(path.resolve(path.dirname(execPath), "../../../apps/dashboard"))
  for (const c of candidates) {
    if (existsSync(path.join(c, "package.json"))) return c
  }
  return null
}

/**
 * Dashboard dist: $UNIFY_UI_DIST, else <repo>/apps/dashboard/dist.
 * callerDir = directory of the importing module (virtual in compiled binary).
 */
export function resolveDistDir(
  callerDir: string,
  env: NodeJS.ProcessEnv = process.env,
  execPath: string = process.execPath,
): string {
  if (env.UNIFY_UI_DIST) return env.UNIFY_UI_DIST
  const dashboardDir = findDashboardDir(callerDir, execPath)
  if (dashboardDir) return path.join(dashboardDir, "dist")
  // no repo layout — fall back to the source-style path (a missing dist then
  // produces a readable error in runUi)
  return path.resolve(callerDir, "../../../../apps/dashboard/dist")
}

export function resolvePort(flag: string | undefined, env: NodeJS.ProcessEnv = process.env): number {
  const raw = flag ?? env.UNIFY_UI_PORT
  const n = Number(raw)
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : 7420
}

/** Find the bun executable (process.execPath is the unify binary when compiled). */
export function findBun(execPath: string = process.execPath): string | null {
  if (path.basename(execPath) === "bun") return execPath
  try {
    const r = Bun.spawnSync(["which", "bun"], { stdout: "pipe", stderr: "ignore" })
    if (r.exitCode === 0) {
      const b = r.stdout.toString().trim()
      if (b) return b
    }
  } catch {
    /* fall through */
  }
  return null
}

export async function runUi(args: Record<string, unknown>): Promise<number> {
  const port = resolvePort(args.port as string | undefined)
  const apiOnly = Boolean(args["api-only"])
  const env = process.env
  const userHome = env.HOME ?? "/root"

  const dashboardDir = findDashboardDir(import.meta.dir, process.execPath)
  let distDir = env.UNIFY_UI_DIST ? env.UNIFY_UI_DIST : dashboardDir ? path.join(dashboardDir, "dist") : null

  const distOk = (d: string | null) => Boolean(d && existsSync(d) && existsSync(path.join(d, "index.html")))

  if (!apiOnly) {
    if (!distOk(distDir)) {
      if (!dashboardDir) {
        console.error(
          "unify ui: dashboard build not found.\n" +
            "  build it in the repo (bun run build:dashboard) and set UNIFY_UI_DIST=<dist dir>,\n" +
            "  or use --api-only with a separate vite dev server.",
        )
        return 1
      }
      const bun = findBun()
      if (!bun) {
        console.error("unify ui: cannot build dashboard — bun not found on PATH")
        return 1
      }
      console.log("unify ui: dashboard build missing — building…")
      const build = Bun.spawn([bun, "run", "build"], {
        cwd: dashboardDir,
        stdout: "inherit",
        stderr: "inherit",
      })
      const code = await build.exited
      if (code !== 0) {
        console.error(`unify ui: dashboard build failed (exit ${code})`)
        return 1
      }
    }
  }

  // fail fast on config errors with a readable message
  const unifyHome = env.UNIFY_HOME ?? path.join(userHome, ".unify")
  const { errors } = await loadUnifyAt(path.join(unifyHome, "unify.yaml"))
  if (errors.length > 0) {
    console.error(`unify ui: config invalid:\n${errors.map((e) => `  - ${e}`).join("\n")}`)
    console.error("  fix: unify init && unify doctor")
    return 1
  }

  const handler = createApiHandler({
    userHome,
    unifyHome,
    distDir: distDir ?? "",
    serveStatic: !apiOnly,
  })

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port,
    fetch: (req) => handler(req),
  })

  console.log(`unify ui: dashboard + API on http://127.0.0.1:${server.port}`)
  console.log("  stop with Ctrl-C")

  let stopping = false
  const stop = (sig: string) => {
    if (stopping) return
    stopping = true
    console.log(`\nunify ui: ${sig} — shutting down…`)
    server.stop()
    process.exit(0)
  }
  process.on("SIGINT", () => stop("SIGINT"))
  process.on("SIGTERM", () => stop("SIGTERM"))

  return new Promise<number>(() => {
    // keep the process alive until a signal
    setInterval(() => {}, 1 << 30)
  })
}
