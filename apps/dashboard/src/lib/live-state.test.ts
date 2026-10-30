import { describe, expect, test } from "bun:test"
import { ApiError } from "./api"
import { classifyFailure } from "./live-state"

/**
 * The demo-mode banner used to fire on ANY /api/status failure and blame
 * "the API is offline — start it with `unify ui`" even when the API was up and
 * returning 500. These cases pin the distinction.
 */
describe("classifyFailure", () => {
  test("fetch failure (status 0) → offline, not reachable", () => {
    const r = classifyFailure(new ApiError(0, "API unreachable (ECONNREFUSED)"))
    expect(r.reachable).toBe(false)
    expect(r.failure).toEqual({ kind: "offline", message: "API unreachable (ECONNREFUSED)" })
  })

  test("HTTP 500 → reachable but API error, not demo mode", () => {
    const r = classifyFailure(new ApiError(500, 'Executable not found in $PATH: "skillshare"'))
    expect(r.reachable).toBe(true)
    expect(r.failure).toEqual({
      kind: "api",
      status: 500,
      message: 'Executable not found in $PATH: "skillshare"',
    })
  })

  test("HTTP 503 (backend disabled/not installed) is an API error too", () => {
    const r = classifyFailure(new ApiError(503, "agentmemory is not installed"))
    expect(r.reachable).toBe(true)
    expect(r.failure.kind).toBe("api")
  })

  test("a non-ApiError throw counts as unreachable, with its message preserved", () => {
    const r = classifyFailure(new Error("boom"))
    expect(r.reachable).toBe(false)
    expect(r.failure).toEqual({ kind: "offline", message: "boom" })
  })

  test("non-Error values are stringified", () => {
    const r = classifyFailure("weird")
    expect(r.failure.message).toBe("weird")
  })
})
