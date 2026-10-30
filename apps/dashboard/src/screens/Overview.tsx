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
import {
  StatusBadge,
  stateLabel,
} from "@/components/shared"
import { memoryCaptures, status } from "@/data/mock"

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
  return (
    <div className="flex flex-col gap-4">
      {/* stat tiles */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatTile icon={RefreshCw} label="Last sync" value="2 min ago" hint="6 targets · 0 errors" />
        <StatTile icon={Brain} label="Memories today" value="14" hint="work: 11 · personal: 3" />
        <StatTile icon={UserRound} label="Active profile" value="work" hint="2 backends enabled" />
        <StatTile icon={Layers} label="Targets in sync" value="5 / 6" hint="1 drift (Codex CLI)" />
      </div>

      <div className="grid gap-4 xl:grid-cols-5">
        {/* backend health */}
        <div className="flex flex-col gap-4 xl:col-span-2">
          {status.backends.map((b) => (
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
                  <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground">
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
        </div>

        {/* IDE sync matrix */}
        <Card className="xl:col-span-3">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">IDE sync matrix</CardTitle>
              <Button variant="outline" size="sm" className="gap-1.5">
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
                  <TableHead className="text-right">Targets</TableHead>
                  <TableHead>Last sync</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {status.targets.map((t) => (
                  <TableRow key={t.tool}>
                    <TableCell className="font-medium">{t.tool}</TableCell>
                    <TableCell>
                      <StatusBadge state={t.state} />
                      {t.note && (
                        <p className="mt-1 max-w-64 text-xs text-muted-foreground">{t.note}</p>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{t.targets}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {t.lastSync === "—" ? "not installed" : t.lastSync}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="mt-3 text-xs text-muted-foreground">
              {stateLabel("in-sync")}, {stateLabel("drift")}, {stateLabel("missing")} and{" "}
              {stateLabel("not-installed")} are computed by adapter status — dry-run first, apply second.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
