import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { parse as parseYaml, stringify as dumpYaml } from "yaml"
import { z } from "zod"

const skillshareBackend = z.object({
  enabled: z.boolean().default(true),
  targets: z.array(z.string()).optional(),
})

const agentmemoryBackend = z.object({
  enabled: z.boolean().default(true),
  namespace: z.string().default("shared"),
})

const profileSchema = z.object({
  backends: z
    .object({
      skillshare: skillshareBackend.default({}),
      agentmemory: agentmemoryBackend.default({}),
    })
    .default({}),
})

const unifySchema = z.object({
  version: z.literal(1),
  profile: z.string().default("work"),
  profiles: z.record(z.string(), profileSchema).default({}),
  glue: z
    .object({ "post-sync": z.array(z.string()).default([]) })
    .default({ "post-sync": [] }),
  secrets: z.record(z.string(), z.object({ env: z.string() })).default({}),
})

export type SkillshareBackend = z.infer<typeof skillshareBackend>
export type AgentmemoryBackend = z.infer<typeof agentmemoryBackend>
export type Profile = z.infer<typeof profileSchema>

export interface UnifyConfig {
  version: 1
  profile: string
  profiles: Record<string, Profile>
  glue: { "post-sync": string[] }
  secrets: Record<string, { env: string }>
}

/** Active profile's resolved backend settings (falls back to enabled defaults). */
export interface ActiveProfile {
  skillshare: SkillshareBackend & { enabled: boolean; targets?: string[] }
  agentmemory: AgentmemoryBackend & { enabled: boolean; namespace: string }
}

export function defaultConfig(): UnifyConfig {
  return {
    version: 1,
    profile: "work",
    profiles: {
      work: {
        backends: {
          skillshare: { enabled: true },
          agentmemory: { enabled: true, namespace: "work" },
        },
      },
    },
    glue: { "post-sync": [] },
    secrets: {},
  }
}

export interface LoadResult {
  config: UnifyConfig
  errors: string[]
}

/**
 * Load a unify.yaml from an explicit file path.
 * - missing file → defaults, no errors
 * - invalid YAML/schema → defaults + errors (never throws)
 * - unknown profile reference → errors
 */
export async function loadUnifyAt(file: string): Promise<LoadResult> {
  let text: string | null = null
  try {
    text = await readFile(file, "utf8")
  } catch {
    text = null
  }

  if (text === null || text.trim() === "") {
    return { config: defaultConfig(), errors: [] }
  }

  let doc: unknown
  try {
    doc = parseYaml(text)
  } catch (e) {
    return {
      config: defaultConfig(),
      errors: [`YAML parse error: ${e instanceof Error ? e.message : String(e)}`],
    }
  }

  const parsed = unifySchema.safeParse(doc)
  if (!parsed.success) {
    return {
      config: defaultConfig(),
      errors: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
    }
  }

  const config = parsed.data as UnifyConfig
  const errors: string[] = []

  if (config.profile !== "work" || !(config.profile in config.profiles)) {
    const available = Object.keys(config.profiles)
    errors.push(
      `unknown profile "${config.profile}" — available: ${available.join(", ") || "(none)"}`,
    )
  }

  return { config, errors }
}

/**
 * Load ~/.unify/unify.yaml under the given home dir (convenience wrapper).
 */
export async function loadUnify(homeDir: string): Promise<LoadResult> {
  return loadUnifyAt(path.join(homeDir, ".unify", "unify.yaml"))
}

/** Default config where the work profile's skillshare targets = detected tools. */
export function defaultConfigForTools(tools: string[]): UnifyConfig {
  const cfg = defaultConfig()
  cfg.profiles.work.backends.skillshare.targets = tools.length > 0 ? tools : ["claude"]
  return cfg
}

export interface WriteUnifyOptions {
  /** Do not overwrite an existing unify.yaml. */
  skipExisting?: boolean
}

/** Serialize config to <dir>/unify.yaml (creates dir). Returns the file path. */
export async function writeUnify(
  config: UnifyConfig,
  dir: string,
  opts: WriteUnifyOptions = {},
): Promise<string> {
  const file = path.join(dir, "unify.yaml")
  if (opts.skipExisting) {
    try {
      await readFile(file)
      return file
    } catch {
      // fall through and write
    }
  }
  await mkdir(dir, { recursive: true })
  const doc = {
    version: config.version,
    profile: config.profile,
    profiles: config.profiles,
    glue: config.glue,
    secrets: config.secrets,
  }
  await writeFile(file, dumpYaml(doc), "utf8")
  return file
}

/** Resolve the active profile's backend settings (for sync/init orchestration). */
export function activeProfile(config: UnifyConfig): ActiveProfile {
  const p = config.profiles[config.profile] ?? config.profiles["work"]
  return {
    skillshare: p?.backends.skillshare ?? { enabled: true },
    agentmemory: p?.backends.agentmemory ?? { enabled: true, namespace: "shared" },
  }
}
