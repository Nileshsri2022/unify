import { GitCompareArrows, Loader2, Play, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { StatusBadge } from "@/components/shared"
import { api, ApiError, type SyncResponse } from "@/lib/api"
import { useLive } from "@/lib/live"
import { dryRunChanges as mockChanges, status as mockStatus } from "@/data/mock"
import { useState } from "react"

export function Sync() {
  const { online, status, refresh } = useLive()
  const live = online === true && status !== null
  const [dryRun, setDryRun] = useState(true)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<SyncResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  // VELTO redesign: the old "Last sync" column was never populated
  // (skillshare fullStatus() never sets TargetRow.lastSync), so it
  // always rendered "never". It is replaced by the target's detail,
  // which the API does populate ("N skill(s) linked", etc.).
  const rows = live
    ? status!.status.targets.map((t) => ({
        key: t.target,
        target: t.target,
        tool: t.tool,
        state: t.state,
        detail: t.detail ?? "",
      }))
    : mockStatus.targets
        .filter((t) => t.state !== "not-installed")
        .map((t) => ({
          key: t.tool,
          target: "",
          tool: t.tool,
          state: t.state,
          detail: t.note,
        }))

  const run = async (opts: { dry: boolean; target?: string }) => {
    setBusy(true)
    setError(null)
    try {
      const r = await api.sync(opts.dry, opts.target)
      setResult(r)
      await refresh()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const changes = result
    ? result.result.changes.map((c) => ({ file: c.target, change: c.action }))
    : live
      ? []
      : mockChanges.map((c) => ({ file: c.file, change: c.change }))

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">
                Sync · profile: {live ? status!.status.profile : "work"}
              </CardTitle>
              <CardDescription>
                skillshare → {rows.filter((r) => r.state !== "not-installed").length} targets · dry-run
                first, apply second
              </CardDescription>
            </div>
            {live && (
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Switch checked={dryRun} onCheckedChange={setDryRun} />
                  dry-run
                </label>
                {dryRun ? (
                  <Button size="sm" className="gap-1.5" disabled={busy} onClick={() => void run({ dry: true })}>
                    {busy ? <Loader2 className="size-3.5 animate-spin" /> : <GitCompareArrows className="size-3.5" />}
                    Run dry-run
                  </Button>
                ) : (
                  <Button size="sm" className="gap-1.5" disabled={busy} onClick={() => void run({ dry: false })}>
                    {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
                    Apply sync
                  </Button>
                )}
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
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tool</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Detail</TableHead>
                {live && <TableHead className="w-24" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((t) => (
                <TableRow key={t.key}>
                  <TableCell className="font-medium">{t.tool}</TableCell>
                  <TableCell>
                    <StatusBadge state={t.state} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">{t.detail || "—"}</TableCell>
                  {live && (
                    <TableCell className="text-right">
                      {t.state === "drift" || t.state === "missing" ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-xs"
                          disabled={busy}
                          onClick={() => void run({ dry: false, target: t.target })}
                        >
                          re-sync (apply)
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">up to date</span>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <GitCompareArrows className="size-4" />
              {result ? (result.result.dryRun ? "Dry-run diff" : "Applied changes") : "Dry-run diff"}
            </CardTitle>
            <CardDescription>
              What <code className="rounded bg-muted px-1 text-xs">unify sync</code>
              {result && !result.result.dryRun ? " changed" : " would change"}
              {live && !result && " — run a dry-run to preview"}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {changes.length === 0 && (
              <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                No changes{live ? " (nothing to preview yet)" : ""}.
              </p>
            )}
            {changes.map((c, i) => (
              <div key={i} className="rounded-md border bg-muted/30 p-3 font-mono text-xs leading-relaxed">
                <p className="mb-1 font-sans font-medium text-foreground">{c.file}</p>
                <p className="text-muted-foreground">{c.change}</p>
              </div>
            ))}
            {result && result.glue.length > 0 && (
              <div className="mt-1 rounded-md border border-primary/30 bg-primary/5 p-3">
                <p className="mb-1 flex items-center gap-1.5 font-sans text-sm font-medium">
                  <Sparkles className="size-3.5" />
                  Post-sync glue
                </p>
                {result.glue.map((g, i) => (
                  <p key={i} className="font-mono text-xs text-muted-foreground">
                    {g}
                  </p>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

    </div>
  )
}
