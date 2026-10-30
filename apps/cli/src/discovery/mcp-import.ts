/**
 * Phase 2 MCP import — one server at a time, secrets never copied.
 *
 * The imported definition is the source server with every secret-bearing
 * field stripped recursively: `env`, `headers`, and any key containing
 * token/key/secret/password/auth. The user must re-enter secrets in the
 * target tool themselves; this function never writes a secret value
 * anywhere, including the target config.
 */
import path from "node:path"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { MCP_CONFIGS } from "./index"

/**
 * Resolve a tool's JSON MCP config path. TOML tools (Codex) and unknown
 * tools throw — they are explicitly unsupported in Phase 2, not guessed.
 */
export function resolveJsonMcpConfig(home: string, tool: string): string {
  const cfgs = MCP_CONFIGS.filter((c) => c.tool === tool)
  if (cfgs.length === 0) throw new Error(`unknown provider for MCP import: ${tool}`)
  const json = cfgs.find((c) => c.format === "json")
  if (!json) throw new Error(`MCP import for ${tool} is TOML-based and not supported in Phase 2`)
  return path.join(home, json.rel)
}

export function validateMemoryText(text: string): string {
  const t = text.trim()
  if (!t) throw new Error("memory text is empty — nothing to import")
  return t
}

const SECRET_KEY = /(env|headers|token|apikey|api_key|secret|password|auth)/i

export function stripSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripSecrets)
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY.test(k)) continue
      out[k] = stripSecrets(v)
    }
    return out
  }
  return value
}

export function hasSecretKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasSecretKey)
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).some(
      ([k, v]) => SECRET_KEY.test(k) || hasSecretKey(v),
    )
  }
  return false
}

export async function importMcpServer(opts: {
  server: string
  fromPath: string
  toPath: string
}): Promise<{ server: string; hadSecrets: boolean; toPath: string }> {
  const { server, fromPath, toPath } = opts
  const source = JSON.parse(await readFile(fromPath, "utf-8")) as Record<string, unknown>
  const servers = source.mcpServers as Record<string, unknown> | undefined
  if (!servers || typeof servers !== "object" || !(server in servers)) {
    throw new Error(`MCP server not found in ${fromPath}: ${server}`)
  }
  const def = servers[server]
  const hadSecrets = hasSecretKey(def)
  const clean = stripSecrets(def)

  let target: Record<string, unknown> = { mcpServers: {} }
  try {
    target = JSON.parse(await readFile(toPath, "utf-8")) as Record<string, unknown>
  } catch {
    // Missing or empty target file: start fresh. A malformed target
    // file is only overwritten if it parses as JSON below — here a
    // read failure is treated as missing, matching Phase 1's
    // missing-config reporting; a JSON parse error must not silently
    // discard an existing config, so re-check explicitly.
    try {
      await readFile(toPath, "utf-8")
      throw new Error(`target MCP config is not valid JSON: ${toPath}`)
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("target MCP config")) throw e
      // genuinely missing: proceed with a fresh config
    }
  }
  if (!target.mcpServers || typeof target.mcpServers !== "object") {
    target.mcpServers = {}
  }
  const targetServers = target.mcpServers as Record<string, unknown>
  if (server in targetServers) {
    throw new Error(`MCP server already exists in ${toPath}: ${server}`)
  }
  targetServers[server] = clean
  await mkdir(path.dirname(toPath), { recursive: true })
  await writeFile(toPath, JSON.stringify(target, null, 2) + "\n", "utf-8")
  return { server, hadSecrets, toPath }
}
