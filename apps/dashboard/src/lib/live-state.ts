import { ApiError } from "./api"

/**
 * Why the dashboard is not showing live data.
 * - "offline": no HTTP response at all (server not running / wrong port)
 * - "api":     the API answered, but with an error (missing backend, bad state…)
 * These are different problems with different fixes, so they get different UI.
 * Telling them apart matters: a 500 from `/api/status` used to be reported as
 * "the API is offline — start it with `unify ui`", which is wrong and unhelpful
 * when the API is running.
 */
export type LiveFailure =
  | { kind: "offline"; message: string }
  | { kind: "api"; status: number; message: string }

export interface ClassifiedFailure {
  /** true = the API answered (it is up, even if it reported an error). */
  reachable: boolean
  failure: LiveFailure
}

/**
 * Map a failed API call to {reachable, failure}.
 * `ApiError.status === 0` means fetch itself failed → truly offline.
 * Any HTTP status means the API is up and reporting a problem.
 */
export function classifyFailure(e: unknown): ClassifiedFailure {
  const err =
    e instanceof ApiError
      ? e
      : new ApiError(0, e instanceof Error ? e.message : String(e))
  if (err.status === 0) {
    return { reachable: false, failure: { kind: "offline", message: err.message } }
  }
  return { reachable: true, failure: { kind: "api", status: err.status, message: err.message } }
}
