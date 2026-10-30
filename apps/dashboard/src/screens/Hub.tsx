import { Loader2, Play, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { api, ApiError, type HubCollectResponse, type HubSyncResponse } from "@/lib/api"
import { useLive } from "@/lib/live"
import { useState } from "react"

export function Hub() {
  const { online } = useLive()
  const live = online === true
  const [busy, setBusy] = useState<"collect" | "sync" | null>(null)
  const [collect, setCollect] = useState<HubCollectResponse | null>(null)
  const [syncResult, setSyncResult] = useState<HubSyncResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = async (kind: "collect" | "sync") => {
    setBusy(kind)
    setError(null)
    try {
      if (kind === "collect") {
        setCollect(await api.hubCollect())
        setSyncResult(null)
      } else {
        const r = await api.hubSync()
        setSyncResult(r)
        setCollect(r.collect)
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">Hub · {collect ? collect.hub : "per-provider skills and MCP"}</CardTitle>
            </div>
            {live && (
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" className="gap-1.5" disabled={busy !== null} onClick={() => void run("collect")}>
                  {busy === "collect" ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                  Collect
                </Button>
                <Button size="sm" className="gap-1.5" disabled={busy !== null} onClick={() => void run("sync")}>
                  {busy === "sync" ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
                  Hub Sync
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
          {!collect && (
            <p className="text-sm text-muted-foreground">
              {live ? "Collect scans every provider's skills and MCP — it only writes to the hub, never to a provider. Hub Sync then distributes hub contents to other providers (collisions skipped, secrets stripped)." : "Start unify ui to see the hub."}
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
                      <TableCell className="max-w-md truncate text-muted-foreground">{s.skills.join(", ") || "—"}</TableCell>
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
                      <TableCell className="max-w-md truncate text-muted-foreground">{m.servers.join(", ") || "—"}</TableCell>
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
            <CardTitle className="text-base">Distributed by Hub Sync</CardTitle>
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
