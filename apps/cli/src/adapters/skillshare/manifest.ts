import type { BackendManifest } from "@unify/core"

export const SKILLSHARE_PINNED_VERSION = "0.28.0"

// Source: https://github.com/runkids/skillshare/releases/tag/v0.28.0 (checksums.txt)
const assets: Record<string, { file: string; sha256: string }> = {
  "darwin-amd64": {
    file: "skillshare_0.28.0_darwin_amd64.tar.gz",
    sha256: "09cd8ad56d8d9721a5276854a1283fdae3e597d262f5c62caf925dcba41007e5",
  },
  "darwin-arm64": {
    file: "skillshare_0.28.0_darwin_arm64.tar.gz",
    sha256: "b246170f21d20a1f47b8b41a09b26b462e0da434e744969d88873a60600bff24",
  },
  "linux-amd64": {
    file: "skillshare_0.28.0_linux_amd64.tar.gz",
    sha256: "c4f3f60d30130014b82e3c383aa64c8c26996920202b1c98db075a5a346c4f96",
  },
  "linux-arm64": {
    file: "skillshare_0.28.0_linux_arm64.tar.gz",
    sha256: "736094664e2d11376838160c3f614b95edaeb18c268a4e53d292cf504a94a464",
  },
  "windows-amd64": {
    file: "skillshare_0.28.0_windows_amd64.zip",
    sha256: "a5b76652ebe1ef8b074fc0ac1d7bea2af53a525420a9a5a9a62990de354bb937",
  },
  "windows-arm64": {
    file: "skillshare_0.28.0_windows_arm64.zip",
    sha256: "6f439d3dd7d236a735e2e55794d79b1935a260fe1296a4be51aa20f5388cabb4",
  },
}

export function currentPlatformKey(): string {
  const os = process.platform === "win32" ? "windows" : process.platform
  const arch = process.arch === "arm64" ? "arm64" : "amd64"
  return `${os}-${arch}`
}

export function pinnedManifest(platformKey: string = currentPlatformKey()): BackendManifest {
  const a = assets[platformKey]
  if (!a) throw new Error(`no pinned skillshare release for platform "${platformKey}"`)
  return {
    version: SKILLSHARE_PINNED_VERSION,
    sha256: a.sha256,
    source: `https://github.com/runkids/skillshare/releases/download/v${SKILLSHARE_PINNED_VERSION}/${a.file}`,
  }
}
