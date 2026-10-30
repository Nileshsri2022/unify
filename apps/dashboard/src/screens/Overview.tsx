import {
  ArrowUpRight,
  Brain,
  CheckCircle2,
  Clock,
  Layers,
  RefreshCw,
  UserRound,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { StatusBadge, stateLabel } from "@/components/shared"
import { ago } from "@/lib/api"
import { useLive } from "@/lib/live"
import { memoryCaptures, status as mockStatus } from "@/data/mock"

const backendDetail: Record<string, string> = {
  skillshare: "config distribution · 76+ targets",
  agentmemory: "persistent memory · REST",
}

function StatTile({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof Clock
  label: string
  value: string
  hint: string
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-4">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted">
          <Icon className="size-5" />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="truncate font-heading text-lg font-semibold">{value}</p>
          <p className="truncate text-xs text-muted-foreground">{hint}</p>
        </div>
      </CardContent>
    </Card>
  )
}

export function Overview() {
  const { online, status: live, setScreen } = useLive()
  const liveOn = online === true && live !== null
  const s = liveOn ? live : null

  // normalized target rows (live + demo share one shape for the table)
  const rows = s
    ? s.status.targets.map((t) => ({
        key: t.target,
        tool: t.tool,
        state: t.state,
        count: null as number | null,
        note: t.detail,
        lastSync: t.lastSync,
      }))
    : mockStatus.targets.map((t) => ({
        key: t.tool,
        tool: t.tool,
        state: t.state,
        count: t.targets as number | null,
        note: t.note,
        lastSync: t.lastSync as string,
      }))

  // stat tiles
  const inSync = rows.filter((t) => t.state === "in-sync").length
  const totalTargets = rows.length
  const drifted = rows.filter((t) => t.state === "drift" || t.state === "missing")
  const memoryTotal = s ? s.status.memory.total : 14

  return (
    <div className="flex flex-col gap-4">
      {/* stat tiles */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatTile
          icon={RefreshCw}
          label="Last sync"
          value={s ? ago(s.lastSync?.at) : "2 min ago"}
          hint={
            s
              ? `${s.lastSync ? `${s.lastSync.changes.length} changes` : "no sync yet"} · ${totalTargets} targets`
              : "6 targets · 0 errors"
          }
        />
        <StatTile
          icon={Brain}
          label="Memories"
          value={String(memoryTotal)}
          hint={s ? s.memoryLine : "work: 11 · personal: 3"}
        />
        <StatTile
          icon={UserRound}
          label="Active profile"
          value={s ? s.status.profile : "work"}
          hint={s ? `${s.status.backends.filter((b) => b.healthy).length} backends healthy` : "2 backends enabled"}
        />
        <StatTile
          icon={Layers}
          label="Targets in sync"
          value={`${inSync} / ${totalTargets}`}
          hint={
            drifted.length > 0
              ? `${drifted.length} needing attention`
              : "all clean"
          }
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-5">
        {/* backend health */}
        <div className="flex flex-col gap-4 xl:col-span-2">
          {s
            ? s.status.backends.map((b) => (
                <Card key={b.id}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="flex items-center gap-2 text-base">
                        <span className="flex size-2.5">
                          <span
                            className={`size-2.5 rounded-full ${b.healthy ? "bg-emerald-500" : "bg-red-500"}`}
                          />
                        </span>
                        {b.id}
                        {b.healthy ? (
                          <Badge variant="secondary" className="gap-1 text-emerald-600 dark:text-emerald-400">
                            <CheckCircle2 className="size-3" />
                            {b.id === "skillshare" ? "in sync" : "active"}
                          </Badge>
                        ) : (
                          <Badge variant="destructive">degraded</Badge>
                        )}
                      </CardTitle>
                      <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground" onClick={() => setScreen("doctor")}>
                        manage
                        <ArrowUpRight className="size-3.5" />
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-1">
                    <p className="text-sm">{backendDetail[b.id] ?? ""}</p>
                    <p className="text-xs text-muted-foreground">
                      v{b.version ?? "?"}
                      {b.pinnedVersion ? ` · pinned v${b.pinnedVersion}` : ""}
                      {b.id === "agentmemory"
                        ? ` · ${s.memoryLine}`
                        : ` · ${inSync}/${totalTargets} targets in sync`}
                    </p>
                    {b.issues.slice(0, 2).map((i, idx) => (
                      <p key={idx} className="text-xs text-amber-600 dark:text-amber-400">
                        ⚠ {i.message}
                      </p>
                    ))}
                  </CardContent>
                </Card>
              ))
            : mockStatus.backends.map((b) => (
                <Card key={b.id}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="flex items-center gap-2 text-base">
                        <span className="flex size-2.5">
                          <span
                            className={`size-2.5 rounded-full ${b.healthy ? "bg-emerald-500" : "bg-red-500"}`}
                          />
                        </span>
                        {b.label}
                        {b.healthy ? (
                          <Badge variant="secondary" className="gap-1 text-emerald-600 dark:text-emerald-400">
                            <CheckCircle2 className="size-3" />
                            {b.id === "skillshare" ? "in sync" : "active"}
                          </Badge>
                        ) : (
                          <Badge variant="destructive">degraded</Badge>
                        )}
                      </CardTitle>
                      <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground" onClick={() => setScreen("doctor")}>
                        manage
                        <ArrowUpRight className="size-3.5" />
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-1">
                    <p className="text-sm">{b.detail}</p>
                    <p className="text-xs text-muted-foreground">
                      v{b.version} · pinned v{b.pinnedVersion} · {b.stat}
                    </p>
                  </CardContent>
                </Card>
              ))}

          {s ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Memory namespaces</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col">
                {s.status.memory.namespaces.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No memories yet.</p>
                ) : (
                  s.status.memory.namespaces.map((n, i) => (
                    <div key={n.name}>
                      {i > 0 && <Separator className="my-2" />}
                      <div className="flex items-center justify-between">
                        <p className="text-sm">{n.name}</p>
                        <p className="font-mono text-sm tabular-nums">{n.count}</p>
                      </div>
                    </div>
                  ))
                )}
                <Button variant="ghost" size="sm" className="mt-2 gap-1 self-start text-muted-foreground" onClick={() => setScreen("memory")}>
                  search memories
                  <ArrowUpRight className="size-3.5" />
                </Button>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Recent memory</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col">
                {memoryCaptures.slice(0, 3).map((m, i) => (
                  <div key={m.id}>
                    {i > 0 && <Separator className="my-2" />}
                    <p className="line-clamp-2 text-sm">{m.text}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {m.source} · {m.when}
                    </p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        {/* IDE sync matrix */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">IDE sync matrix</CardTitle>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setScreen("sync")}>
                <RefreshCw className="size-3.5" />
                Re-sync
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tool</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">{s ? "Path / target" : "Targets"}</TableHead>
                  <TableHead>Last sync</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((t) => (
                  <TableRow key={t.key}>
                    <TableCell className="font-medium">{t.tool}</TableCell>
                    <TableCell>
                      <StatusBadge state={t.state} />
                      {t.note && (
                        <p className="mt-1 max-w-64 truncate text-xs text-muted-foreground">{t.note}</p>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {t.count === null ? "" : t.count}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {t.lastSync ? (s ? ago(t.lastSync) : t.lastSync) : "never"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="mt-3 text-xs text-muted-foreground">
              {stateLabel("in-sync")}, {stateLabel("drift")}, {stateLabel("missing")} and{" "}
              {stateLabel("not-installed")} are computed by adapter status — dry-run first, apply
              second.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
