import {
  ChevronDown,
  GitCompareArrows,
  LayoutDashboard,
  Brain,
  RefreshCw,
  Stethoscope,
  UserRound,
  Search,
  ShieldAlert,
  WifiOff,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Doctor } from "@/screens/Doctor"
import { Memory } from "@/screens/Memory"
import { Overview } from "@/screens/Overview"
import { ProfileScreen } from "@/screens/Profile"
import { Sync } from "@/screens/Sync"
import { cn } from "@/lib/utils"
import { LIVE_POLL_MS, LiveProvider, useLive, type ScreenId } from "@/lib/live"

const nav: { id: ScreenId; label: string; icon: typeof Brain }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "sync", label: "Sync", icon: GitCompareArrows },
  { id: "memory", label: "Memory", icon: Brain },
  { id: "profile", label: "Profiles", icon: UserRound },
  { id: "doctor", label: "Doctor", icon: Stethoscope },
]

const titles: Record<ScreenId, { title: string; sub: string }> = {
  overview: { title: "Overview", sub: "Your AI agent stack at a glance" },
  sync: { title: "Sync", sub: "Distribute config to every tool" },
  memory: { title: "Memory", sub: "What your agents learned from you" },
  profile: { title: "Profiles", sub: "work / personal contexts" },
  doctor: { title: "Doctor", sub: "Health of the whole stack" },
}

const retryHint = `retrying every ${Math.round(LIVE_POLL_MS / 1000)}s`

function Shell() {
  const { online, status, profiles, failure, screen, setScreen, search, setSearch, switchProfile } =
    useLive()
  // live = API reachable. A reachable-but-erroring API is still "live" — it gets
  // its own banner instead of the misleading demo-mode one.
  const live = online === true
  const offline = online === false || failure?.kind === "offline"

  const onSearch = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && search.trim()) {
      setScreen("memory")
    }
  }

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {/* sidebar */}
      <aside className="fixed inset-y-0 left-0 z-10 flex w-56 flex-col border-r">
        <div className="flex items-center gap-2 px-4 py-4">
          <div className="flex size-7 items-center justify-center rounded-md bg-primary font-heading text-sm font-bold text-primary-foreground">
            u
          </div>
          <div>
            <p className="font-heading text-sm font-semibold leading-none">unify</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">agent stack manager</p>
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 px-2 py-2">
          {nav.map((item) => {
            const Icon = item.icon
            const active = screen === item.id
            return (
              <button
                key={item.id}
                onClick={() => setScreen(item.id)}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors",
                  active
                    ? "bg-accent font-medium text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                )}
              >
                <Icon className="size-4" />
                {item.label}
              </button>
            )
          })}
        </nav>
        <div className="border-t px-4 py-3 text-[11px] text-muted-foreground">
          <p className="flex items-center gap-1.5">
            {online === null ? (
              <>
                <span className="size-1.5 animate-pulse rounded-full bg-amber-500" />
                checking API…
              </>
            ) : live ? (
              <>
                <span className="size-1.5 rounded-full bg-emerald-500" />
                live · {status?.status.profile ?? "…"} profile
              </>
            ) : offline ? (
              <>
                <span className="size-1.5 rounded-full bg-amber-500" />
                demo mode (API offline)
              </>
            ) : (
              <>
                <span className="size-1.5 rounded-full bg-red-500" />
                live · API error
              </>
            )}
          </p>
          <p className="mt-1">unify v0.2.0</p>
        </div>
      </aside>

      {/* main */}
      <div className="ml-56 flex-1">
        {/* topbar */}
        <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b bg-background/80 px-6 py-3 backdrop-blur">
          <div>
            <h1 className="font-heading text-lg font-semibold leading-tight">{titles[screen].title}</h1>
            <p className="text-xs text-muted-foreground">{titles[screen].sub}</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative hidden md:block">
              <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={onSearch}
                placeholder="Search memories… (Enter)"
                className="h-9 w-64 pl-8"
              />
            </div>
            {live && profiles && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-1.5">
                    <UserRound className="size-3.5" />
                    {profiles.active}
                    <ChevronDown className="size-3.5 opacity-60" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuLabel>Profiles</DropdownMenuLabel>
                  {profiles.profiles.map((p) => (
                    <DropdownMenuItem
                      key={p.name}
                      className={p.active ? "font-medium" : ""}
                      onClick={() => void switchProfile(p.name)}
                    >
                      <span
                        className={cn(
                          "mr-2 inline-block size-1.5 rounded-full",
                          p.active ? "bg-emerald-500" : "bg-transparent ring-1 ring-muted-foreground/40",
                        )}
                      />
                      {p.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setScreen("sync")}>
              <RefreshCw className="size-3.5" />
              Sync
            </Button>
          </div>
        </header>

        {/* demo banner — only when there is truly no API responding */}
        {offline && (
          <div className="flex items-start gap-2 border-b bg-amber-500/10 px-6 py-2 text-xs text-amber-800 dark:text-amber-300">
            <WifiOff className="mt-0.5 size-3.5 shrink-0" />
            <span>
              <strong>Demo mode</strong> — the unify API is offline, so this dashboard shows mock
              data. Start it with <code className="rounded bg-muted px-1">unify ui</code>{" "}
              <span className="opacity-80">({retryHint}, no reload needed)</span>.
            </span>
          </div>
        )}

        {/* the API is up but returned an error — show it instead of blaming "offline" */}
        {!offline && failure?.kind === "api" && (
          <div className="flex items-start gap-2 border-b bg-red-500/10 px-6 py-2 text-xs text-red-800 dark:text-red-300">
            <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
            <span>
              <strong>API error {failure.status}</strong> — {failure.message}
              <span className="opacity-80">
                {" "}
                · the dashboard falls back to mock data where the API failed. Fix it with{" "}
                <code className="rounded bg-muted px-1">unify doctor</code>, then {retryHint}.
              </span>
            </span>
          </div>
        )}

        <main className="px-6 py-5">
          {screen === "overview" && <Overview />}
          {screen === "sync" && <Sync />}
          {screen === "memory" && <Memory />}
          {screen === "profile" && <ProfileScreen />}
          {screen === "doctor" && <Doctor />}
        </main>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <LiveProvider>
      <Shell />
    </LiveProvider>
  )
}
