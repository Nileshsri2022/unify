import { readFile, stat } from "node:fs/promises"
import path from "node:path"
import { Orchestrator, type OrchestratorOptions } from "./orchestrate"

export interface ApiServerOptions extends OrchestratorOptions {
  userHome: string
  unifyHome: string
  /** Directory of the built dashboard (dist/). */
  distDir: string
  /** When false, skip static serving (vite dev workflow). */
  serveStatic?: boolean
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  })
}

async function readBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const t = await req.text()
    return t ? (JSON.parse(t) as Record<string, unknown>) : {}
  } catch {
    throw Object.assign(new Error("invalid JSON body"), { status: 400 })
  }
}

/**
 * The `unify ui` HTTP handler: /api/* JSON endpoints + static dashboard.
 * One server, one port — the dashboard and the CLI always agree because
 * both go through the same Orchestrator.
 */
export function createApiHandler(opts: ApiServerOptions): (req: Request) => Promise<Response> {
  const o = new Orchestrator(opts.userHome, opts.unifyHome, opts)
  const serveStatic = opts.serveStatic !== false && Boolean(opts.distDir)

  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url)
    const p = url.pathname

    if (p.startsWith("/api/")) {
      try {
        if (p === "/api/status") return json(await o.status())
        if (p === "/api/doctor") return json({ issues: await o.doctor() })
        if (p === "/api/profiles" && req.method === "GET") return json(await o.profiles())
        if (p === "/api/profiles" && req.method === "POST") {
          const body = await readBody(req)
          const name = typeof body.name === "string" ? body.name : ""
          if (!name) throw Object.assign(new Error("missing name"), { status: 400 })
          return json(await o.switchProfile(name))
        }
        if (p === "/api/memory" && req.method === "GET") {
          const q = url.searchParams.get("q")
          if (!q) throw Object.assign(new Error("missing query param q"), { status: 400 })
          const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 10) || 10, 1), 50)
          return json(await o.memoryRecall(q, limit, url.searchParams.get("profile")))
        }
        if (p === "/api/memory" && req.method === "POST") {
          const body = await readBody(req)
          const text = typeof body.text === "string" ? body.text.trim() : ""
          if (!text) throw Object.assign(new Error("missing text"), { status: 400 })
          const concepts = Array.isArray(body.concepts)
            ? (body.concepts as unknown[]).filter((c): c is string => typeof c === "string")
            : []
          return json(await o.memorySave(text, concepts))
        }
        if (p === "/api/sync" && req.method === "POST") {
          const body = await readBody(req)
          const dryRun = body.dryRun !== false
          const target = typeof body.target === "string" ? [body.target] : undefined
          return json(await o.sync({ dryRun, targets: target }))
        }
        if (p === "/api/hub/collect" && req.method === "POST") {
          return json(await o.hubCollect())
        }
        if (p === "/api/hub/sync" && req.method === "POST") {
          return json(await o.hubSync())
        }
        return json({ error: `unknown API route: ${p}` }, 404)
      } catch (e) {
        const status = (e as { status?: number }).status ?? 500
        const msg = e instanceof Error ? e.message : String(e)
        return json({ error: msg }, status)
      }
    }

    // static dashboard (with SPA fallback)
    if (serveStatic) {
      try {
        const rel = path.normalize(decodeURIComponent(p)).replace(/^([/\\])+/, "")
        let filePath = path.join(opts.distDir, rel)
        try {
          const st = await stat(filePath)
          if (st.isDirectory()) filePath = path.join(filePath, "index.html")
        } catch {
          // unknown path: assets 404, everything else → SPA fallback
          if (!rel.includes(".")) filePath = path.join(opts.distDir, "index.html")
          else return json({ error: "not found" }, 404)
        }
        const data = await readFile(filePath)
        const mime = MIME[path.extname(filePath).toLowerCase()] ?? "application/octet-stream"
        return new Response(data, { headers: { "content-type": mime } })
      } catch {
        return json(
          { error: "dashboard build not found — run: bun run --cwd apps/dashboard build" },
          503,
        )
      }
    }
    return json({ error: "not found" }, 404)
  }
}
