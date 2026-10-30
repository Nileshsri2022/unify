import { CheckCircle2, Info, Loader2, RefreshCw, Stethoscope, TriangleAlert, XCircle } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { api, ApiError, type HealthIssue } from "@/lib/api"
import { useLive } from "@/lib/live"
import { doctorIssues as mockIssues } from "@/data/mock"
import { useEffect, useState } from "react"

const severityMeta = {
  error: { icon: XCircle, label: "error", className: "text-red-600 dark:text-red-400" },
  warn: { icon: TriangleAlert, label: "warning", className: "text-amber-600 dark:text-amber-400" },
  info: { icon: Info, label: "info", className: "text-sky-600 dark:text-sky-400" },
} as const

export function Doctor() {
  const { online } = useLive()
  const live = online === true
  const [issues, setIssues] = useState<HealthIssue[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      const r = await api.doctor()
      setIssues(r.issues)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (live) void run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live])

  const list: (HealthIssue & { id: string })[] = live
    ? (issues ?? []).map((i, idx) => ({ ...i, id: `live-${idx}` }))
    : mockIssues

  const errors = list.filter((i) => i.severity === "error").length
  const warns = list.filter((i) => i.severity === "warn").length
  const infos = list.filter((i) => i.severity === "info").length

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Stethoscope className="size-4" />
                Doctor
              </CardTitle>
              <CardDescription>
                Cross-backend health: versions, drift, coverage, env — one pass
              </CardDescription>
            </div>
            {live && (
              <Button variant="outline" size="sm" className="gap-1.5" disabled={busy} onClick={() => void run()}>
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                Run doctor again
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {error && (
            <div className="mb-4 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-400">
              {error}
            </div>
          )}
          {live && busy && issues === null && (
            <p className="py-6 text-center text-sm text-muted-foreground">running…</p>
          )}
          {live && issues !== null && (
            <>
              <div className="mb-4 grid grid-cols-3 gap-3">
                <div className="rounded-md border p-3 text-center">
                  <p className="font-heading text-2xl font-semibold text-red-600 dark:text-red-400">
                    {errors}
                  </p>
                  <p className="text-xs text-muted-foreground">errors</p>
                </div>
                <div className="rounded-md border p-3 text-center">
                  <p className="font-heading text-2xl font-semibold text-amber-600 dark:text-amber-400">
                    {warns}
                  </p>
                  <p className="text-xs text-muted-foreground">warnings</p>
                </div>
                <div className="rounded-md border p-3 text-center">
                  <p
                    className={`font-heading text-2xl font-semibold ${
                      errors + warns === 0
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-muted-foreground"
                    }`}
                  >
                    {errors + warns === 0 ? "✓" : infos}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {errors + warns === 0 ? "all checks passed" : "info"}
                  </p>
                </div>
              </div>

              {list.length === 0 ? (
                <div className="flex items-center gap-3 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-4">
                  <CheckCircle2 className="size-5 text-emerald-600 dark:text-emerald-400" />
                  <div>
                    <p className="text-sm font-medium">All checks passed</p>
                    <p className="text-xs text-muted-foreground">
                      skillshare + agentmemory installed, server healthy, config valid
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col">
                  {list.map((issue, i) => {
                    const meta = severityMeta[issue.severity]
                    const Icon = meta.icon
                    return (
                      <div
                        key={issue.id}
                        className={`flex flex-wrap items-center justify-between gap-3 py-3 ${
                          i > 0 ? "border-t" : ""
                        }`}
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <Icon className={`size-4 shrink-0 ${meta.className}`} />
                          <div className="min-w-0">
                            <p className="truncate text-sm">{issue.message}</p>
                            <p className="text-xs text-muted-foreground">{issue.backend}</p>
                          </div>
                        </div>
                        {issue.fix ? (
                          <Button variant="outline" size="sm" className="shrink-0 font-mono text-xs">
                            {issue.fix}
                          </Button>
                        ) : (
                          issue.severity !== "info" && <Badge variant="outline">review</Badge>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          )}
          {!live && (
            <>
              <div className="mb-4 grid grid-cols-3 gap-3">
                <div className="rounded-md border p-3 text-center">
                  <p className="font-heading text-2xl font-semibold text-red-600 dark:text-red-400">
                    {errors}
                  </p>
                  <p className="text-xs text-muted-foreground">errors</p>
                </div>
                <div className="rounded-md border p-3 text-center">
                  <p className="font-heading text-2xl font-semibold text-amber-600 dark:text-amber-400">
                    {warns}
                  </p>
                  <p className="text-xs text-muted-foreground">warnings</p>
                </div>
                <div className="rounded-md border p-3 text-center">
                  <p className="font-heading text-2xl font-semibold text-emerald-600 dark:text-emerald-400">
                    {infos}
                  </p>
                  <p className="text-xs text-muted-foreground">info / all clear</p>
                </div>
              </div>
              <div className="flex flex-col">
                {list.map((issue, i) => {
                  const meta = severityMeta[issue.severity]
                  const Icon = meta.icon
                  const isInfoOk = issue.severity === "info" && issue.message.startsWith("Backend")
                  return (
                    <div
                      key={issue.id}
                      className={`flex flex-wrap items-center justify-between gap-3 py-3 ${
                        i > 0 ? "border-t" : ""
                      }`}
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        {issue.severity === "info" && isInfoOk ? (
                          <CheckCircle2 className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                        ) : (
                          <Icon className={`size-4 shrink-0 ${meta.className}`} />
                        )}
                        <div className="min-w-0">
                          <p className="truncate text-sm">{issue.message}</p>
                          <p className="text-xs text-muted-foreground">{issue.backend}</p>
                        </div>
                      </div>
                      {issue.fix ? (
                        <Button variant="outline" size="sm" className="shrink-0 font-mono text-xs">
                          {issue.fix}
                        </Button>
                      ) : (
                        issue.severity !== "info" && <Badge variant="outline">review</Badge>
                      )}
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
