import { defineCommand } from "citty"

// Kept in sync with apps/cli/package.json (embedded: compiled binary has no
// package.json next to it).
export const CLI_VERSION = "0.1.0"

export function printVersionLine(): string {
  return `unify v${CLI_VERSION}`
}

export const versionCommand = defineCommand({
  meta: { name: "version", description: "Print unify version" },
  async run() {
    console.log(printVersionLine())
  },
})
