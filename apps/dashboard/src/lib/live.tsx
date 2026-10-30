import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import { api, ApiError, type ProfilesResponse, type StatusResponse } from "./api"

export type ScreenId = "overview" | "sync" | "memory" | "profile" | "doctor"

interface LiveContextValue {
  /** null = still probing, true = API live, false = demo (mock) mode */
  online: boolean | null
  status: StatusResponse | null
  profiles: ProfilesResponse | null
  lastError: string | null
  refresh: () => Promise<void>
  switchProfile: (name: string) => Promise<boolean>
  screen: ScreenId
  setScreen: (s: ScreenId) => void
  search: string
  setSearch: (q: string) => void
}

const LiveContext = createContext<LiveContextValue | null>(null)

export function LiveProvider({ children }: { children: ReactNode }) {
  const [online, setOnline] = useState<boolean | null>(null)
  const [status, setStatus] = useState<StatusResponse | null>(null)
  const [profiles, setProfiles] = useState<ProfilesResponse | null>(null)
  const [lastError, setLastError] = useState<string | null>(null)
  const [screen, setScreen] = useState<ScreenId>("overview")
  const [search, setSearch] = useState("")

  const refresh = useCallback(async () => {
    try {
      const [s, p] = await Promise.all([api.status(), api.profiles()])
      setStatus(s)
      setProfiles(p)
      setOnline(true)
      setLastError(null)
    } catch (e) {
      setOnline(false)
      setLastError(e instanceof ApiError ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    void refresh()
    // status changes on sync/switch — poll lightly so the dashboard stays fresh
    const t = setInterval(() => void refresh(), 30000)
    return () => clearInterval(t)
  }, [refresh])

  const switchProfile = useCallback(
    async (name: string) => {
      try {
        await api.switchProfile(name)
        await refresh()
        return true
      } catch (e) {
        setLastError(e instanceof ApiError ? e.message : String(e))
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
      lastError,
      refresh,
      switchProfile,
      screen,
      setScreen,
      search,
      setSearch,
    }),
    [online, status, profiles, lastError, refresh, switchProfile, screen, search],
  )

  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>
}

export function useLive(): LiveContextValue {
  const v = useContext(LiveContext)
  if (!v) throw new Error("useLive must be used inside <LiveProvider>")
  return v
}
