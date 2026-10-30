import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import { parse } from "yaml"

/**
 * CI has silently never run in this repo once already: an unquoted
 * `- name: smoke: unify version` is a compact mapping in plain YAML, so every
 * run failed in 0s with "this run likely failed because of a workflow file
 * issue" and zero jobs. It happened a second time while adding a job by hand —
 * hence this guard: if the workflow does not parse, the tests say so.
 */

const repoRoot = path.resolve(import.meta.dir, "../../..")
const workflowFile = path.join(repoRoot, ".github", "workflows", "ci.yml")

interface Step {
  name?: string
  uses?: string
  run?: string
}
interface Job {
  "runs-on": string
  steps: Step[]
}
interface Workflow {
  on: Record<string, unknown>
  jobs: Record<string, Job>
}

function loadWorkflow(): Workflow {
  return parse(readFileSync(workflowFile, "utf8")) as Workflow
}

describe("ci.yml", () => {
  test("parses as YAML and defines jobs with steps", () => {
    const wf = loadWorkflow()
    const jobs = Object.entries(wf.jobs)
    expect(jobs.length).toBeGreaterThanOrEqual(2)
    for (const [id, job] of jobs) {
      expect(job["runs-on"], `${id} runs-on`).toBeTruthy()
      expect(Array.isArray(job.steps) && job.steps.length > 0, `${id} steps`).toBe(true)
    }
  })

  test("every modern step runs something (uses | run), so no empty step slips through", () => {
    for (const [id, job] of Object.entries(loadWorkflow().jobs)) {
      for (const step of job.steps) {
        const runs = Boolean(step.uses || step.run)
        expect(runs, `${id}: step "${step.name ?? "(unnamed)"}" has neither uses nor run`).toBe(true)
      }
    }
  })

  test("covers the platforms we support: one linux job and one windows job", () => {
    const runners = Object.values(loadWorkflow().jobs).map((j) => j["runs-on"])
    expect(runners.some((r) => r.startsWith("ubuntu"))).toBe(true)
    expect(runners.some((r) => r.startsWith("windows"))).toBe(true)
  })

  test("runs the test suite on a pull request", () => {
    const wf = loadWorkflow()
    expect(Object.keys(wf.on)).toContain("pull_request")
    const runsTests = Object.values(wf.jobs).some((job) =>
      job.steps.some((s) => (s.run ?? "").includes("bun test")),
    )
    expect(runsTests).toBe(true)
  })
})
