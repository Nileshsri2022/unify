/**
 * agentmemory REST client (pinned v0.9.31 contract — see
 * apps/cli/testdata/agentmemory/0.9.31/README.md).
 *
 * Transport note: unify talks REST, not the MCP shim. The shim is a thin
 * proxy that needs the same running server for its full tool surface, so the
 * server is managed either way — see docs/plans/M2-agentmemory-adapter.md.
 */

export class ServerDownError extends Error {
  constructor(cause?: unknown) {
    super(
      `agentmemory server unreachable: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    )
    this.name = "ServerDownError"
  }
}

export class AuthError extends Error {
  constructor() {
    super("agentmemory REST auth failed (401) — secret missing or stale")
    this.name = "AuthError"
  }
}

export interface RecallResult {
  obsId: string
  score: number
  title: string
  type: string
}

export interface MemoryClient {
  /** Unauthenticated liveness probe. */
  livez(): Promise<{ status: string; viewerPort?: number }>
  /** Bearer health check; carries the server version. */
  health(): Promise<{ status: string; version: string }>
  /** Total indexed memories (index.memoriesIndexed). */
  memoryCount(): Promise<number>
  /**
   * Save a memory; returns its id.
   * `agentId` tags the memory with a profile namespace (v0.9.31: body field).
   */
  save(content: string, concepts?: string[], agentId?: string): Promise<string>
  /**
   * BM25/smart search.
   * `agentId` scopes the search to a profile namespace — must be sent in the
   * REQUEST BODY (v0.9.31 ignores the `?agentId=` query param on this endpoint).
   */
  recall(query: string, limit?: number, agentId?: string): Promise<RecallResult[]>
}

export interface RestMemoryClientOptions {
  /** e.g. http://localhost:3111 */
  baseUrl: string
  /** Bearer token (from ~/.agentmemory/secret). Omit for livez-only use. */
  secret?: string
}

export class RestMemoryClient implements MemoryClient {
  constructor(private o: RestMemoryClientOptions) {}

  private get base(): string {
    return this.o.baseUrl.replace(/\/$/, "")
  }

  private authHeaders(extra: Record<string, string> = {}): Record<string, string> {
    const h: Record<string, string> = { ...extra }
    if (this.o.secret) h["Authorization"] = `Bearer ${this.o.secret}`
    return h
  }

  private async request(
    path: string,
    init: RequestInit = {},
    opts: { auth: boolean } = { auth: true },
  ): Promise<unknown> {
    let res: Response
    try {
      res = await fetch(`${this.base}${path}`, {
        ...init,
        headers: {
          ...(init.headers as Record<string, string> | undefined),
          ...(opts.auth ? this.authHeaders() : {}),
        },
      })
    } catch (e) {
      throw new ServerDownError(e)
    }
    if (res.status === 401 || res.status === 403) throw new AuthError()
    if (!res.ok) {
      const text = await res.text().catch(() => "")
      throw new Error(`agentmemory REST ${path} failed: HTTP ${res.status} ${text}`.trim())
    }
    return res.json()
  }

  async livez(): Promise<{ status: string; viewerPort?: number }> {
    const d = (await this.request("/agentmemory/livez", {}, { auth: false })) as {
      status: string
      viewerPort?: number
    }
    return d
  }

  async health(): Promise<{ status: string; version: string }> {
    const d = (await this.request("/agentmemory/health")) as {
      status: string
      version: string
    }
    return d
  }

  async memoryCount(): Promise<number> {
    const d = (await this.request("/agentmemory/status")) as {
      index?: { memoriesIndexed?: number }
    }
    return d.index?.memoriesIndexed ?? 0
  }

  async save(content: string, concepts: string[] = [], agentId?: string): Promise<string> {
    const body: Record<string, unknown> = { content, concepts }
    if (agentId) body.agentId = agentId
    const d = (await this.request("/agentmemory/remember", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })) as { memory?: { id?: string }; success?: boolean }
    if (!d.memory?.id) throw new Error("agentmemory remember: no memory id in response")
    return d.memory.id
  }

  async recall(query: string, limit = 10, agentId?: string): Promise<RecallResult[]> {
    const body: Record<string, unknown> = { query, limit }
    if (agentId) body.agentId = agentId
    const d = (await this.request("/agentmemory/smart-search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })) as {
      results?: { obsId?: string; score?: number; title?: string; type?: string }[]
    }
    return (d.results ?? []).map((r) => ({
      obsId: r.obsId ?? "",
      score: r.score ?? 0,
      title: r.title ?? "",
      type: r.type ?? "",
    }))
  }
}
