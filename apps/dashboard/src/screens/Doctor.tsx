import { CheckCircle2, Info, Stethoscope, TriangleAlert, XCircle } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { doctorIssues } from "@/data/mock"

const severityMeta = {
  error: { icon: XCircle, label: "error", className: "text-red-600 dark:text-red-400" },
  warn: { icon: TriangleAlert, label: "warning", className: "text-amber-600 dark:text-amber-400" },
  info: { icon: Info, label: "info", className: "text-sky-600 dark:text-sky-400" },
} as const

export function Doctor() {
  const errors = doctorIssues.filter((i) => i.severity === "error").length
  const warns = doctorIssues.filter((i) => i.severity === "warn").length
  const infos = doctorIssues.filter((i) => i.severity === "info").length

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
            <Button variant="outline" size="sm">
              Run doctor again
            </Button>
          </div>
        </CardHeader>
        <CardContent>
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
            {doctorIssues.map((issue, i) => {
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
        </CardContent>
      </Card>
    </div>
  )
}
