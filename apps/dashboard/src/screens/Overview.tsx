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
import { ago, api, type HubStatusResponse } from "@/lib/api"
import { useLive } from "@/lib/live"
import { status as mockStatus } from "@/data/mock"
import { useEffect, useState } from "react"

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
      <CardContent className="flex items-center gap-4 p-5">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted">
          <Icon className="size-5" />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="truncate font-heading text-xl font-semibold">{value}</p>
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
  const [hubStatus, setHubStatus] = useState<HubStatusResponse | null>(null)
  useEffect(() => {
    if (!liveOn) return
    api.hubStatus().then(setHubStatus).catch(() => {})
  }, [liveOn])

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

      <div className="flex max-w-2xl flex-col gap-4">
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

          {hubStatus && (
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Hub</CardTitle>
                  <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground" onClick={() => setScreen("hub")}>
                    open hub
                    <ArrowUpRight className="size-3.5" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm">
                  {hubStatus.collect.skills.length} providers ·{" "}
                  {hubStatus.collect.skills.reduce((n, x) => n + x.skills.length, 0)} skills ·{" "}
                  {hubStatus.collect.mcp.reduce((n, x) => n + x.servers.length, 0)} MCP servers
                </p>
                <p className="mt-1 text-xs text-muted-foreground">Last shared {ago(hubStatus.at)}</p>
              </CardContent>
            </Card>
          )}
        </div>

    </div>
  )
}
