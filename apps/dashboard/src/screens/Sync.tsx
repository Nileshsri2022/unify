import { GitCompareArrows, Play, ShieldCheck } from "lucide-react"
import { Badge } from "@/components/ui/badge"
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
import { dryRunChanges, status } from "@/data/mock"
import { useState } from "react"

export function Sync() {
  const [dryRun, setDryRun] = useState(true)

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">Sync · profile: work</CardTitle>
              <CardDescription>
                skillshare → 6 targets · dry-run first, apply second
              </CardDescription>
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <Switch checked={dryRun} onCheckedChange={setDryRun} />
                dry-run
              </label>
              <Button size="sm" className="gap-1.5" disabled={dryRun}>
                <Play className="size-3.5" />
                Apply sync
              </Button>
            </div>
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
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {status.targets
                .filter((t) => t.state !== "not-installed")
                .map((t) => (
                  <TableRow key={t.tool} data-state={t.state}>
                    <TableCell className="font-medium">{t.tool}</TableCell>
                    <TableCell>
                      <StatusBadge state={t.state} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{t.targets}</TableCell>
                    <TableCell className="text-muted-foreground">{t.lastSync}</TableCell>
                    <TableCell className="text-right">
                      {t.state === "drift" || t.state === "missing" ? (
                        <Button variant="ghost" size="sm" className="text-xs">
                          re-sync
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">up to date</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <GitCompareArrows className="size-4" />
              Dry-run diff
            </CardTitle>
            <CardDescription>
              What <code className="rounded bg-muted px-1 text-xs">unify sync --dry-run</code> would
              change
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {dryRunChanges.map((c, i) => (
              <div
                key={i}
                className="rounded-md border bg-muted/30 p-3 font-mono text-xs leading-relaxed"
              >
                <p className="mb-1 font-sans font-medium text-foreground">{c.file}</p>
                <p className="text-muted-foreground">{c.change}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="size-4" />
              Safety
            </CardTitle>
            <CardDescription>What unify never does without asking</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <div className="flex items-start gap-2">
              <Badge variant="outline" className="mt-0.5 shrink-0">
                backup
              </Badge>
              <p>
                Every write-back keeps a recoverable backup of the previous file
                (<code className="rounded bg-muted px-1 text-xs">~/.unify/cache/</code>).
              </p>
            </div>
            <div className="flex items-start gap-2">
              <Badge variant="outline" className="mt-0.5 shrink-0">
                additive
              </Badge>
              <p>
                Entries are merged, never blindly overwritten — manual edits in a tool's own config
                are collision-protected.
              </p>
            </div>
            <div className="flex items-start gap-2">
              <Badge variant="outline" className="mt-0.5 shrink-0">
                pinned
              </Badge>
              <p>
                Backend binaries are SHA256-pinned; an unpinned or mismatched binary blocks sync.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
