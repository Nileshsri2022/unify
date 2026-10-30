import { describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { printVersionLine } from "./commands/version"

describe("version command", () => {
  test("prints package name and version", () => {
    const line = printVersionLine()
    expect(line).toContain("unify")
    expect(line).toMatch(/v\d+\.\d+\.\d+/)
  })

  test("version matches package.json", async () => {
    const pkgPath = new URL("../package.json", import.meta.url)
    const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as { version: string }
    expect(printVersionLine()).toContain(pkg.version)
  })
})
