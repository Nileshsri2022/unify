import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import { api, type ProfilesResponse, type StatusResponse } from "./api"
import { classifyFailure, type LiveFailure } from "./live-state"

export type { LiveFailure } from "./live-state"

export type ScreenId = "overview" | "sync" | "memory" | "profile" | "doctor"

interface LiveContextValue {
  /** null = still probing, true = API reachable, false = no API at all */
  online: boolean | null
  status: StatusResponse | null
  profiles: ProfilesResponse | null
  /** Last failure; null when the last refresh was clean. */
  failure: LiveFailure | null
  /** Short human message for the last failure (null when healthy). */
  lastError: string | null
  refresh: () => Promise<void>
  switchProfile: (name: string) => Promise<boolean>
  screen: ScreenId
  setScreen: (s: ScreenId) => void
  search: string
  setSearch: (q: string) => void
}

const LiveContext = createContext<LiveContextValue | null>(null)

/** Poll cadence — also the retry cadence after the API comes up/down. */
export const LIVE_POLL_MS = 30_000

export function LiveProvider({ children }: { children: ReactNode }) {
  const [online, setOnline] = useState<boolean | null>(null)
  const [status, setStatus] = useState<StatusResponse | null>(null)
  const [profiles, setProfiles] = useState<ProfilesResponse | null>(null)
  const [failure, setFailure] = useState<LiveFailure | null>(null)
  const [screen, setScreen] = useState<ScreenId>("overview")
  const [search, setSearch] = useState("")

  const refresh = useCallback(async () => {
    try {
      const [s, p] = await Promise.all([api.status(), api.profiles()])
      setStatus(s)
      setProfiles(p)
      setOnline(true)
      setFailure(null)
    } catch (e) {
      const { reachable, failure } = classifyFailure(e)
      setOnline(reachable)
      setFailure(failure)
      if (!reachable) {
        // server gone: stale data would be misleading
        setStatus(null)
        setProfiles(null)
      }
    }
  }, [])

  useEffect(() => {
    void refresh()
    // status changes on sync/switch — poll lightly so the dashboard stays fresh
    // (and so it recovers by itself once `unify ui` is started or fixed)
    const t = setInterval(() => void refresh(), LIVE_POLL_MS)
    return () => clearInterval(t)
  }, [refresh])

  const switchProfile = useCallback(
    async (name: string) => {
      try {
        await api.switchProfile(name)
        await refresh()
        return true
      } catch (e) {
        setFailure(classifyFailure(e).failure)
        return false
      }
    },
    [refresh],
  )

  const value = useMemo(
    () => ({
      online,
      status,
      profiles,
      failure,
      lastError: failure?.message ?? null,
      refresh,
      switchProfile,
      screen,
      setScreen,
      search,
      setSearch,
    }),
    [online, status, profiles, failure, refresh, switchProfile, screen, search],
  )

  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>
}

export function useLive(): LiveContextValue {
  const v = useContext(LiveContext)
  if (!v) throw new Error("useLive must be used inside <LiveProvider>")
  return v
}
