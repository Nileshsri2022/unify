/**
 * Hub watcher — detection only. It reports which provider subdir
 * changed, debounced. It never applies anything to a provider;
 * applying is `hub sync`'s job, after the user clicks/commands it.
 */
import { watch, type FSWatcher } from "node:fs"
import path from "node:path"

export function watchHub(
  hub: string,
  providers: string[],
  onChange: (provider: string) => void,
  debounceMs = 300,
): { close(): void } {
  const watchers: FSWatcher[] = []
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const fire = (provider: string) => {
    const prev = timers.get(provider)
    if (prev) clearTimeout(prev)
    timers.set(
      provider,
      setTimeout(() => {
        timers.delete(provider)
        onChange(provider)
      }, debounceMs),
    )
  }
  const add = (dir: string, provider: string) => {
    try {
      watchers.push(watch(dir, { persistent: true }, () => fire(provider)))
    } catch {
      // Missing dir: nothing to watch yet; collect creates it.
    }
  }
  add(hub, "")
  for (const p of providers) add(path.join(hub, p), p)
  return {
    close() {
      for (const w of watchers) w.close()
      for (const t of timers.values()) clearTimeout(t)
    },
  }
}
