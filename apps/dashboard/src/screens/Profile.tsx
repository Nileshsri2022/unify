import { Brain, Check, Layers, Loader2, UserRound } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useLive } from "@/lib/live"
import { profiles as mockProfiles } from "@/data/mock"
import { useState } from "react"

export function ProfileScreen() {
  const { online, profiles, switchProfile, refresh } = useLive()
  const live = online === true && profiles !== null
  const [busyName, setBusyName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const pList = live
    ? profiles!.profiles.map((p) => ({
        id: p.name as "work" | "personal",
        name: p.name,
        active: p.active,
        memoryNamespace: p.backends.agentmemory.namespace,
        backends: p.backends,
      }))
    : mockProfiles

  const doSwitch = async (name: string) => {
    setBusyName(name)
    setError(null)
    const ok = await switchProfile(name)
    if (!ok) setError(`Could not switch to “${name}” (see error above)`)
    setBusyName(null)
    if (ok) void refresh()
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        {pList.map((p) => (
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
                  <Button size="sm" variant="outline" disabled={busyName !== null} onClick={() => void doSwitch(p.name)}>
                    {busyName === p.name && <Loader2 className="size-3.5 animate-spin" />}
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
                    p.backends.skillshare.targets.length > 0 ? (
                      p.backends.skillshare.targets.map((t) => (
                        <Badge key={t} variant="secondary">
                          {t}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-sm text-muted-foreground">all detected targets</span>
                    )
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

    </div>
  )
}
