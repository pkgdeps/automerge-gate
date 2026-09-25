import type { AggregatedCheckRun } from './filter.js'

// A GitHub Actions workflow run on the head SHA, as returned by
// `GET /repos/{owner}/{repo}/actions/runs?head_sha=...`. Only the fields
// needed to decide supersession are kept.
export type WorkflowRunSummary = {
  id: number
  path: string
  event: string
  check_suite_id: number
}

// Returns the check_suite ids of workflow runs that a newer run of the
// same workflow file, started by the same event, has replaced on this SHA.
//
// Two `pull_request` events for one SHA (a bot pushing the same commit
// twice, `opened` + `labeled`, a re-delivered webhook) start every
// workflow twice. With `concurrency: cancel-in-progress: true` the second
// run cancels the first, and the first run's jobs stay on the SHA as
// `cancelled` check_runs in their own check_suite. The Checks API's
// `filter=latest` only collapses re-runs inside one suite, so the gate
// has to recognise the replaced run itself.
//
// Runs are grouped by (workflow path, event): a `push` run and a
// `pull_request` run of the same workflow are independent verdicts and
// never replace each other. Within a group the highest run id is the
// newest (ids are assigned at creation), and every other run in the group
// is replaced.
export const findReplacedSuites = (
  workflowRuns: WorkflowRunSummary[]
): Set<number> => {
  const newest = new Map<string, number>()
  const key = (r: WorkflowRunSummary): string =>
    JSON.stringify([r.path, r.event])
  for (const r of workflowRuns) {
    const current = newest.get(key(r))
    if (current === undefined || r.id > current) newest.set(key(r), r.id)
  }
  const replaced = new Set<number>()
  for (const r of workflowRuns) {
    if (newest.get(key(r)) !== r.id) replaced.add(r.check_suite_id)
  }
  return replaced
}

// Drops `cancelled` check_runs that belong to a replaced workflow run.
// Only cancellations are dropped: a job that failed before its run was
// replaced still counts, because the newer run may skip that job via
// `if:` (a `skipped` conclusion is green) without proving the failure
// away. The newest run of each workflow is always evaluated as is, so a
// manual cancel with no newer run stays red.
export const dropReplacedCancellations = (
  runs: AggregatedCheckRun[],
  replacedSuites: Set<number>
): { kept: AggregatedCheckRun[]; dropped: AggregatedCheckRun[] } => {
  const kept: AggregatedCheckRun[] = []
  const dropped: AggregatedCheckRun[] = []
  for (const r of runs) {
    if (r.conclusion === 'cancelled' && replacedSuites.has(r.suite_id)) {
      dropped.push(r)
    } else {
      kept.push(r)
    }
  }
  return { kept, dropped }
}
