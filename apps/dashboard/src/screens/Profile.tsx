import { Brain, Check, Layers, UserRound } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { profiles } from "@/data/mock"

export function ProfileScreen() {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-2">
        {profiles.map((p) => (
          <Card key={p.id} className={p.active ? "border-primary/40" : ""}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-base">
                  <UserRound className="size-4" />
                  {p.name}
                  {p.active && (
                    <Badge className="gap-1">
                      <Check className="size-3" />
                      active
                    </Badge>
                  )}
                </CardTitle>
                {!p.active && (
                  <Button size="sm" variant="outline">
                    Switch to {p.name}
                  </Button>
                )}
              </div>
              <CardDescription>
                One switch flips config + memory namespace + cost attribution together
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div>
                <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Layers className="size-3.5" />
                  skillshare targets
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {p.backends.skillshare.enabled ? (
                    p.backends.skillshare.targets.map((t) => (
                      <Badge key={t} variant="secondary">
                        {t}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-sm text-muted-foreground">disabled</span>
                  )}
                </div>
              </div>
              <div>
                <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Brain className="size-3.5" />
                  memory namespace
                </p>
                {p.backends.agentmemory.enabled ? (
                  <Badge variant="secondary">{p.backends.agentmemory.namespace}</Badge>
                ) : (
                  <span className="text-sm text-muted-foreground">disabled</span>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">What a profile switch changes</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm sm:grid-cols-3">
          <div className="rounded-md border bg-muted/30 p-3">
            <p className="font-medium">Targets</p>
            <p className="mt-1 text-xs text-muted-foreground">
              work → 6 tools · personal → 2 tools. Next sync re-renders skillshare config for the
              active set.
            </p>
          </div>
          <div className="rounded-md border bg-muted/30 p-3">
            <p className="font-medium">Memory namespace</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Recall is scoped to the active namespace — work decisions never leak into personal
              sessions.
            </p>
          </div>
          <div className="rounded-md border bg-muted/30 p-3">
            <p className="font-medium">Cost attribution</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Token usage is tagged with the active profile, so per-profile spend stays visible.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
