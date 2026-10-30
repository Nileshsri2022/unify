import { Brain, FileText, MessageSquareText, Settings2, Search } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { memoryCaptures } from "@/data/mock"
import { useMemo, useState } from "react"

const kindMeta = {
  correction: { icon: MessageSquareText, label: "correction", className: "text-red-700 dark:text-red-400" },
  decision: { icon: FileText, label: "decision", className: "text-sky-700 dark:text-sky-400" },
  preference: { icon: Settings2, label: "preference", className: "text-violet-700 dark:text-violet-400" },
  context: { icon: Brain, label: "context", className: "text-emerald-700 dark:text-emerald-400" },
} as const

export function Memory() {
  const [query, setQuery] = useState("")
  const [tab, setTab] = useState<"all" | "work" | "personal">("all")

  const filtered = useMemo(
    () =>
      memoryCaptures.filter(
        (m) =>
          (tab === "all" || m.namespace === tab) &&
          (query.trim() === "" || m.text.toLowerCase().includes(query.toLowerCase())),
      ),
    [query, tab],
  )

  const counts = {
    all: memoryCaptures.length,
    work: memoryCaptures.filter((m) => m.namespace === "work").length,
    personal: memoryCaptures.filter((m) => m.namespace === "personal").length,
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Brain className="size-4" />
                Memory
              </CardTitle>
              <CardDescription>
                Captured automatically while you work · shared across every agent via agentmemory
              </CardDescription>
            </div>
            <div className="relative w-full max-w-xs">
              <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search memories…"
                className="pl-8"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
            <TabsList>
              <TabsTrigger value="all">all ({counts.all})</TabsTrigger>
              <TabsTrigger value="work">work ({counts.work})</TabsTrigger>
              <TabsTrigger value="personal">personal ({counts.personal})</TabsTrigger>
            </TabsList>
            <div className="mt-3">
              <ScrollArea className="h-120 max-h-120 pr-3">
                <div className="flex flex-col">
                  {filtered.length === 0 && (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      No memories match “{query}”.
                    </p>
                  )}
                  {filtered.map((m, i) => {
                    const meta = kindMeta[m.kind]
                    const Icon = meta.icon
                    return (
                      <div key={m.id} className={m.superseded ? "opacity-50" : ""}>
                        {i > 0 && <Separator className="my-3" />}
                        <div className="flex items-start gap-3">
                          <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
                            <Icon className={`size-4 ${meta.className}`} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm leading-relaxed">{m.text}</p>
                            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                              <Badge variant="outline" className={`text-xs ${meta.className}`}>
                                {meta.label}
                              </Badge>
                              <span>{m.source}</span>
                              <span>·</span>
                              <span>{m.when}</span>
                              {m.superseded && (
                                <Badge variant="secondary" className="text-xs">
                                  superseded
                                </Badge>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </ScrollArea>
            </div>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  )
}
