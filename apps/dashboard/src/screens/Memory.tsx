import {
  Brain,
  Check,
  Loader2,
  MessageSquareText,
  Plus,
  Search,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { api, ApiError, type MemoryResponse, type RecallResult } from "@/lib/api"
import { useLive } from "@/lib/live"
import { memoryCaptures } from "@/data/mock"
import { useEffect, useMemo, useRef, useState } from "react"

const kindMeta = {
  correction: { icon: MessageSquareText, label: "correction", className: "text-red-700 dark:text-red-400" },
  decision: { icon: Brain, label: "decision", className: "text-sky-700 dark:text-sky-400" },
  preference: { icon: Brain, label: "preference", className: "text-violet-700 dark:text-violet-400" },
  context: { icon: Brain, label: "context", className: "text-emerald-700 dark:text-emerald-400" },
} as const

function memoryKind(type: string): keyof typeof kindMeta {
  const t = type.toLowerCase()
  if (t.includes("correct")) return "correction"
  if (t.includes("decision")) return "decision"
  if (t.includes("prefer")) return "preference"
  return "context"
}

export function Memory() {
  const { online, profiles, search, setSearch, status } = useLive()
  const live = online === true
  const [tab, setTab] = useState<string>("all")
  const [localQuery, setLocalQuery] = useState(search)
  const [result, setResult] = useState<MemoryResponse | null>(null)
  const [searched, setSearched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [savedNote, setSavedNote] = useState<string | null>(null)
  const [note, setNote] = useState("")
  const [noteBusy, setNoteBusy] = useState(false)
  const seq = useRef(0)

  // topbar search lands here
  useEffect(() => {
    if (search) setLocalQuery(search)
  }, [search])

  const profileNames = live && profiles ? profiles.profiles.map((p) => p.name) : ["work", "personal"]

  // debounced live search
  useEffect(() => {
    if (!live) return
    const q = localQuery.trim()
    if (!q) {
      setResult(null)
      setSearched(false)
      return
    }
    const id = ++seq.current
    const t = setTimeout(async () => {
      setBusy(true)
      try {
        if (tab === "all") {
          const all = await Promise.all(
            profileNames.map((p) => api.memory(q, 10, p).catch(() => null)),
          )
          const merged: RecallResult[] = all
            .filter((r): r is MemoryResponse => r !== null)
            .flatMap((r) => r.results)
            .sort((a, b) => b.score - a.score)
            .slice(0, 20)
          if (seq.current === id) {
            setResult({ profile: status?.status.profile ?? "", namespace: "all", results: merged })
            setSearched(true)
          }
        } else {
          const r = await api.memory(q, 10, tab)
          if (seq.current === id) {
            setResult(r)
            setSearched(true)
          }
        }
      } catch (e) {
        if (seq.current === id) setSavedNote(e instanceof ApiError ? e.message : String(e))
      } finally {
        if (seq.current === id) setBusy(false)
      }
    }, 400)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, localQuery, tab, profileNames.join(",")])

  const counts = useMemo(() => {
    if (live) return null
    return {
      all: memoryCaptures.length,
      work: memoryCaptures.filter((m) => m.namespace === "work").length,
      personal: memoryCaptures.filter((m) => m.namespace === "personal").length,
    }
  }, [live])

  const saveNote = async () => {
    const text = note.trim()
    if (!text) return
    setNoteBusy(true)
    setSavedNote(null)
    try {
      await api.saveMemory(text)
      setNote("")
      setLocalQuery("")
      setSearch("")
      const q = text.slice(0, 40)
      const r = await api.memory(q, 5)
      setResult(r)
      setSearched(true)
    } catch (e) {
      setSavedNote(e instanceof ApiError ? e.message : String(e))
    } finally {
      setNoteBusy(false)
    }
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
                {live
                  ? "Scoped per profile via agentmemory — search recalls what your agents remembered"
                  : "Captured automatically while you work · shared across every agent via agentmemory"}
              </CardDescription>
            </div>
            {live && (
              <div className="flex items-center gap-2">
                <Input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void saveNote()}
                  placeholder="Add a memory for this profile…"
                  className="h-9 w-64"
                />
                <Button size="sm" className="gap-1" disabled={noteBusy || !note.trim()} onClick={() => void saveNote()}>
                  {noteBusy ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
                  Save
                </Button>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {savedNote && (
            <div className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-800 dark:text-amber-300">
              {savedNote}
            </div>
          )}
          <Tabs value={tab} onValueChange={(v) => setTab(v)}>
            <TabsList>
              <TabsTrigger value="all">
                all{counts ? ` (${counts.all})` : ""}
              </TabsTrigger>
              {profileNames.map((p) => (
                <TabsTrigger key={p} value={p}>
                  {p}
                  {counts && p in counts ? ` (${counts[p as "work" | "personal"]})` : ""}
                </TabsTrigger>
              ))}
            </TabsList>
            {live && (
              <div className="relative mt-3 w-full max-w-xs">
                <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                <Input
                  value={localQuery}
                  onChange={(e) => setLocalQuery(e.target.value)}
                  placeholder="Search memories… (live)"
                  className="pl-8"
                />
              </div>
            )}
            <div className="mt-3">
              {live ? (
                <ScrollArea className="h-120 max-h-120 pr-3">
                  <div className="flex flex-col">
                    {!searched && (
                      <p className="py-8 text-center text-sm text-muted-foreground">
                        Type a search term to recall memories{tab === "all" ? " across all profiles" : ` in “${tab}”`}.
                      </p>
                    )}
                    {searched && !busy && result && result.results.length === 0 && (
                      <p className="py-8 text-center text-sm text-muted-foreground">
                        No memories matched “{localQuery}”
                        {tab !== "all" ? ` in ${tab}` : ""}.
                      </p>
                    )}
                    {busy && <p className="py-8 text-center text-sm text-muted-foreground">searching…</p>}
                    {result?.results.map((m, i) => {
                      const kind = memoryKind(m.type)
                      const meta = kindMeta[kind]
                      const Icon = meta.icon
                      return (
                        <div key={m.obsId}>
                          {i > 0 && <Separator className="my-3" />}
                          <div className="flex items-start gap-3">
                            <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
                              <Icon className={`size-4 ${meta.className}`} />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm leading-relaxed">{m.title}</p>
                              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                <Badge variant="outline" className={`text-xs ${meta.className}`}>
                                  {m.type || kind}
                                </Badge>
                                <span>score {m.score.toFixed(2)}</span>
                                <span>·</span>
                                <span className="font-mono">{m.obsId.slice(0, 18)}…</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </ScrollArea>
              ) : (
                <ScrollArea className="h-120 max-h-120 pr-3">
                  <div className="flex flex-col">
                    {memoryCaptures
                      .filter(
                        (m) =>
                          (tab === "all" || m.namespace === tab) &&
                          (localQuery.trim() === "" ||
                            m.text.toLowerCase().includes(localQuery.toLowerCase())),
                      )
                      .map((m, i) => {
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
              )}
            </div>
          </Tabs>
          {live && (
            <p className="mt-2 text-xs text-muted-foreground">
              {status ? `active profile: ${status.status.profile} · ` : ""}
              saves go to the active profile namespace ·{" "}
              <Check className="inline size-3" /> isolation is per-profile
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
