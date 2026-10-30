/**
 * Phase 1 skills import: copy a discovered skill into the skillshare
 * source directory. The original tool's copy is never modified or
 * deleted. After import, a normal `unify sync` distributes the skill
 * to all other providers like any other source skill.
 */
import path from "node:path"
import { cp, stat } from "node:fs/promises"

export async function importSkill(opts: {
  name: string
  fromDir: string
  sourceDir: string
}): Promise<string> {
  const { name, fromDir, sourceDir } = opts
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
    throw new Error(`invalid skill name: ${name}`)
  }
  if (name === "skillshare") {
    throw new Error(`refusing to import skillshare itself`)
  }
  const src = path.join(fromDir, name)
  const srcStat = await stat(src).catch(() => null)
  if (!srcStat || !srcStat.isDirectory()) {
    throw new Error(`skill not found: ${src}`)
  }
  const dest = path.join(sourceDir, name)
  // Path-escape guard: dest must stay inside sourceDir.
  const rel = path.relative(sourceDir, dest)
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`skill name escapes source directory: ${name}`)
  }
  const destStat = await stat(dest).catch(() => null)
  if (destStat) {
    throw new Error(`skill already exists in source: ${name}`)
  }
  await cp(src, dest, { recursive: true })
  return dest
}
