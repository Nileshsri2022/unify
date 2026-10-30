import { Loader2, Play, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ago, api, ApiError, type HubCollectResponse, type HubSyncResponse } from "@/lib/api"
import { useLive } from "@/lib/live"
import { useEffect, useState } from "react"

export function Hub() {
  const { online, refresh } = useLive()
  const live = online === true
  const [busy, setBusy] = useState<"collect" | "sync" | null>(null)
  const [collect, setCollect] = useState<HubCollectResponse | null>(null)
  const [lastAt, setLastAt] = useState<string | null>(null)
  const [syncResult, setSyncResult] = useState<HubSyncResponse | null>(null)
  const [skillshareChanges, setSkillshareChanges] = useState<number | null>(null)
  const [skillshareError, setSkillshareError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Render the last saved inventory instantly on open — collect is
  // expensive (it scans and copies files), so it must not run on
  // every visit. The server saves the result after each run.
  useEffect(() => {
    if (!live) return
    let cancelled = false
    api
      .hubStatus()
      .then((s) => {
        if (cancelled || !s) return
        setCollect(s.collect)
        setLastAt(s.at)
        if (s.distributeSkills || s.distributeMcp) {
          setSyncResult({ collect: s.collect, distributeSkills: s.distributeSkills ?? [], distributeMcp: s.distributeMcp ?? [] })
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [live])

  const runCollect = async () => {
    setBusy("collect")
    setError(null)
    try {
      const c = await api.hubCollect()
      setCollect(c)
      setLastAt(new Date().toISOString())
      setSyncResult(null)
      setSkillshareChanges(null)
      setSkillshareError(null)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const runSyncEverything = async () => {
    setBusy("sync")
    setError(null)
    try {
      const r = await api.syncEverything()
      setSyncResult(r.hub)
      setCollect(r.hub.collect)
      setLastAt(new Date().toISOString())
      setSkillshareChanges(r.skillshare ? r.skillshare.result.changes.length : null)
      setSkillshareError(r.skillshareError ?? null)
      await refresh()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const totalSkills = collect ? collect.skills.reduce((n, s) => n + s.skills.length, 0) : 0
  const totalMcp = collect ? collect.mcp.reduce((n, m) => n + m.servers.length, 0) : 0
  const copied = syncResult ? syncResult.distributeSkills.filter((r) => r.action === "copied").length : 0
  const skipped = syncResult ? syncResult.distributeSkills.filter((r) => r.action === "skipped").length : 0
  const merged = syncResult ? syncResult.distributeMcp.filter((r) => r.action === "merged").length : 0

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">Hub · {collect ? collect.hub : "per-provider skills and MCP"}</CardTitle>
              {lastAt && <p className="mt-1 text-xs text-muted-foreground">Last collected {ago(lastAt)}</p>}
            </div>
            {live && (
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" className="gap-1.5" disabled={busy !== null} onClick={() => void runCollect()}>
                  {busy === "collect" ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                  Collect (preview only)
                </Button>
                <Button size="sm" className="gap-1.5" disabled={busy !== null} onClick={() => void runSyncEverything()}>
                  {busy === "sync" ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
                  Sync Everything
                </Button>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {error && (
            <div className="mb-3 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-400">
              {error}
            </div>
          )}
          {skillshareError && (
            <div className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
              Hub shared OK, but skillshare sync failed: {skillshareError}
            </div>
          )}
          {collect && syncResult && (
            <p className="mb-4 rounded-md border bg-muted/30 p-3 text-sm">
              {collect.skills.length} providers · {totalSkills} skills · {totalMcp} MCP servers · {copied} copied ·{" "}
              {skipped} skipped (already present) · {merged} MCP merged
              {skillshareChanges !== null ? ` · skillshare: ${skillshareChanges} changes` : ""}
            </p>
          )}
          {!collect && (
            <p className="text-sm text-muted-foreground">
              {live
                ? "Sync Everything gathers every provider's skills and MCP, shares them to all other providers (skipped, never overwritten), then runs skillshare sync. Collect (preview only) gathers without sharing."
                : "Start unify ui to see the hub."}
            </p>
          )}
          {collect && (
            <div className="flex flex-col gap-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Provider</TableHead>
                    <TableHead>Skills</TableHead>
                    <TableHead>State</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {collect.skills.map((s) => (
                    <TableRow key={s.provider}>
                      <TableCell className="font-medium">{s.provider}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {s.skills.length === 0 ? (
                          "—"
                        ) : (
                          <details>
                            <summary className="cursor-pointer">{s.skills.length} skills</summary>
                            <p className="mt-1 text-xs leading-relaxed">{s.skills.join(", ")}</p>
                          </details>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{s.state}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Provider</TableHead>
                    <TableHead>MCP servers</TableHead>
                    <TableHead>State</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {collect.mcp.map((m) => (
                    <TableRow key={m.provider}>
                      <TableCell className="font-medium">{m.provider}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {m.servers.length === 0 ? (
                          "—"
                        ) : (
                          <details>
                            <summary className="cursor-pointer">{m.servers.length} servers</summary>
                            <p className="mt-1 text-xs leading-relaxed">{m.servers.join(", ")}</p>
                          </details>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{m.state}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {syncResult && (syncResult.distributeSkills.length > 0 || syncResult.distributeMcp.length > 0) && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">What Sync Everything shared</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 text-sm">
            {syncResult.distributeSkills.map((r, i) => (
              <p key={`s-${i}`} className="text-muted-foreground">
                {r.provider}: {r.skill} — {r.action}
              </p>
            ))}
            {syncResult.distributeMcp.map((r, i) => (
              <p key={`m-${i}`} className="text-muted-foreground">
                {r.provider}: {r.server} — {r.action}
              </p>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
