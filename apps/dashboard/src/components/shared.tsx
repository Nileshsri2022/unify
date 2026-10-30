import { CheckCircle2, CircleDashed, CircleOff, TriangleAlert } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import type { TargetState } from "@/data/mock"

export function stateLabel(state: TargetState) {
  switch (state) {
    case "in-sync":
      return "in sync"
    case "drift":
      return "drift"
    case "missing":
      return "missing"
    case "not-installed":
      return "not installed"
  }
}

export function StatusBadge({ state }: { state: TargetState }) {
  const base = "gap-1"
  switch (state) {
    case "in-sync":
      return (
        <Badge variant="secondary" className={`${base} text-emerald-700 dark:text-emerald-400`}>
          <CheckCircle2 className="size-3" />
          in sync
        </Badge>
      )
    case "drift":
      return (
        <Badge variant="secondary" className={`${base} text-amber-700 dark:text-amber-400`}>
          <TriangleAlert className="size-3" />
          drift
        </Badge>
      )
    case "missing":
      return (
        <Badge variant="secondary" className={`${base} text-orange-700 dark:text-orange-400`}>
          <CircleOff className="size-3" />
          missing
        </Badge>
      )
    case "not-installed":
      return (
        <Badge variant="outline" className={`${base} text-muted-foreground`}>
          <CircleDashed className="size-3" />
          not installed
        </Badge>
      )
  }
}
