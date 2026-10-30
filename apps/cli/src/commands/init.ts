import { defineCommand } from "citty"
import {
  activeProfile,
  defaultConfigForTools,
  ensureHome,
  loadUnifyAt,
  unifyHome,
  writeUnify,
} from "@unify/core"
import { createInterface } from "node:readline/promises"
import { readFile, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { buildRegistry } from "../adapters/registry"
import {
  detectInstalledTools,
  pinnedManifest,
  skillshareBinName,
  SkillshareAdapter,
} from "../adapters/skillshare"
import { AgentmemoryAdapter } from "../adapters/agentmemory"
import { AGENTS_MD_TEMPLATE } from "../glue"
import { readLock, renderSync, writeLastSync, writeLock } from "./state-io"

async function confirm(prompt: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const a = (await rl.question(prompt)).trim().toLowerCase()
  rl.close()
  return a === "y" || a === "yes"
}

export interface InstallAttempt {
  ok: boolean
  error?: string
}

/**
 * Run a backend install without letting the error escape.
 *
 * `unify init` is the first command a new user runs, so a blocked download
 * (proxy, firewall, TLS interception) must print an actionable hint — not a
 * Bun stack trace from citty's top-level handler. Returns ok/error instead of
 * throwing; the caller decides whether the run can continue.
 */
export async function attemptInstall(
  label: string,
  install: () => Promise<void>,
  log: (line: string) => void = console.error,
): Promise<InstallAttempt> {
  try {
    await install()
    return { ok: true }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    log(`unify init: ${label} install failed — ${error}`)
    return { ok: false, error }
  }
}

/** Actionable lines for a failed skillshare download (uses the pinned asset). */
export function skillshareInstallHints(manifestSource?: string, manifestSha?: string): string[] {
  const lines = [
    "  check: this machine can reach github.com release assets (proxy / firewall / TLS interception)",
  ]
  if (manifestSource) {
    lines.push(`  manual: download ${manifestSource}`)
    if (manifestSha) lines.push(`          verify sha256 ${manifestSha}`)
    lines.push("          extract it to ~/.unify/backends/skillshare/skillshare (chmod +x)")
  }
  lines.push("  then re-run: unify init")
  return lines
}

export const initCommand = defineCommand({
  meta: {
    name: "init",
    description: "First-run setup: detect tools, install pinned backends, write unify.yaml, first sync",
  },
  args: {
    yes: { type: "boolean", description: "Answer yes to all prompts (apply first sync)" },
    skipInstall: {
      type: "boolean",
      description: "Do not download the pinned skillshare binary",
    },
  },
  async run({ args }) {
    const home = unifyHome()
    const userHome = os.homedir()

    console.log("unify init")
    console.log("")
    await ensureHome(home)
    console.log(`unify home: ${home}`)

    // 0. Canonical AGENTS.md template (post-sync glue reads this)
    const agentsMdFile = path.join(home, "AGENTS.md")
    try {
      await readFile(agentsMdFile)
    } catch {
      await writeFile(agentsMdFile, AGENTS_MD_TEMPLATE)
      console.log(`created ${agentsMdFile} (edit it; synced into memory after each unify sync)`)
    }

    // 1. Detect installed AI tools
    const tools = await detectInstalledTools(userHome)
    console.log(`Detected AI tools: ${tools.length > 0 ? tools.join(", ") : "(none)"}`)

    // 2. Write unify.yaml if absent (never clobber)
    const cfgFile = await writeUnify(defaultConfigForTools(tools), home, { skipExisting: true })
    const { config, errors } = await loadUnifyAt(cfgFile)
    for (const e of errors) console.error(`config: ${e}`)
    if (errors.length > 0) process.exitCode = 1
    const ap = activeProfile(config)
    const desiredTargets = ap.skillshare.targets ?? []
    console.log(`profile "${config.profile}": skillshare targets = ${desiredTargets.join(", ") || "(none)"}`)

    // 3. Ensure pinned backend binary
    // The registry resolves the binary per call, so a binary installed below is
    // picked up by the very next detect().
    const reg = await buildRegistry(userHome, home)
    const adapter = reg.get("skillshare") as SkillshareAdapter
    let det = await adapter.detect()
    if (!det.installed && !args.skipInstall) {
      console.log("Installing pinned skillshare …")
      let source: string | undefined
      let sha: string | undefined
      const attempt = await attemptInstall("skillshare", async () => {
        const manifest = pinnedManifest()
        source = manifest.source
        sha = manifest.sha256
        await adapter.install(manifest)
        const lock = (await readLock(home)) ?? {}
        lock["skillshare"] = manifest
        await writeLock(home, lock)
      })
      if (!attempt.ok) {
        for (const line of skillshareInstallHints(source, sha)) console.error(line)
        process.exitCode = 1
        return
      }
      det = await adapter.detect()
    }
    if (!det.installed) {
      const expected = path.join(home, "backends", "skillshare", skillshareBinName())
      if (args.skipInstall) {
        console.error("unify init: skillshare not installed (--skip-install was passed)")
        console.error(`  expected binary: ${expected}`)
        console.error("  re-run without --skip-install, or set SKILLSHARE_BIN")
      } else {
        console.error("unify init: skillshare still not detected after installing")
        console.error(`  expected binary: ${expected}`)
        console.error("  re-run: unify init   (or set SKILLSHARE_BIN to an existing binary)")
      }
      process.exitCode = 1
      return
    }
    console.log(`skillshare ${det.version}${det.path ? ` (${det.path})` : ""}`)

    // 3b. agentmemory backend (profile-enabled)
    if (ap.agentmemory.enabled) {
      const am = reg.get("agentmemory") as AgentmemoryAdapter
      let amDet = await am.detect()
      if (!amDet.installed && !args.skipInstall) {
        console.log("Installing pinned agentmemory …")
        const attempt = await attemptInstall("agentmemory", async () => {
          const amManifest = am.manifest()
          await am.install(amManifest)
          const lock = (await readLock(home)) ?? {}
          lock["agentmemory"] = amManifest
          await writeLock(home, lock)
        })
        if (!attempt.ok) {
          console.error("  check: npm can reach registry.npmjs.org (proxy / registry config)")
          console.error("  skillshare sync will still run; fix and re-run: unify init")
          process.exitCode = 1
        }
        amDet = await am.detect()
      }
      if (amDet.installed) {
        console.log(`agentmemory ${amDet.version ?? "?"} — ensuring memory server …`)
        await am.ensureServer()
        console.log("agentmemory server ready")
      } else if (!args.skipInstall) {
        console.error("agentmemory install failed")
        process.exitCode = 1
      }
    }

    // 4. Ensure skillshare state + desired targets (CLI only)
    const state = await adapter.ensureState(desiredTargets)
    if (state.initialized) console.log("skillshare initialized (--no-copy, all detected targets)")
    if (state.added.length > 0) console.log(`targets added: ${state.added.join(", ")}`)

    // 5. Dry-run preview
    const dry = await adapter.sync({ dryRun: true })
    console.log("")
    console.log(renderSync(dry, dry.changes))
    if (dry.error) {
      console.error(`dry-run failed: ${dry.error}`)
      process.exitCode = 1
      return
    }

    // 6. Confirm + apply
    const apply = args.yes ? true : await confirm("Apply sync now? [y/N] ")
    if (!apply) {
      console.log("Skipped — run `unify sync` later.")
      return
    }
    const res = await adapter.sync({ dryRun: false })
    console.log("")
    console.log(renderSync(res, res.changes))
    if (res.error) {
      process.exitCode = 1
      return
    }
    await writeLastSync(home, {
      at: new Date().toISOString(),
      backend: res.backend,
      dryRun: false,
      changes: res.changes,
    })
    console.log("")
    console.log("Done. Run `unify status` to verify.")
  },
})
