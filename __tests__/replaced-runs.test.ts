import { describe, expect, it } from 'vitest'
import type { AggregatedCheckRun } from '../src/filter.js'
import {
  dropReplacedCancellations,
  findReplacedSuites,
  pendingRunsWithoutJobs,
  type WorkflowRunSummary
} from '../src/replaced-runs.js'

const wr = (
  id: number,
  suite: number,
  path = '.github/workflows/ci.yml',
  event = 'pull_request',
  status = 'completed'
): WorkflowRunSummary => ({
  id,
  name: 'ci',
  path,
  event,
  status,
  check_suite_id: suite,
  html_url: `https://github.com/o/r/actions/runs/${id}`
})

const cr = (
  id: number,
  suite: number,
  name: string,
  conclusion: string | null,
  status = 'completed'
): AggregatedCheckRun => ({
  id,
  name,
  status,
  conclusion,
  details_url: '',
  app: { slug: 'github-actions' },
  suite_id: suite
})

describe('findReplacedSuites', () => {
  it('marks older runs of the same workflow and event', () => {
    const s = findReplacedSuites([wr(1, 10), wr(2, 20), wr(3, 30)])
    expect([...s].sort()).toEqual([10, 20])
  })

  it('keeps runs of different workflows apart', () => {
    const s = findReplacedSuites([
      wr(1, 10, '.github/workflows/a.yml'),
      wr(2, 20, '.github/workflows/b.yml')
    ])
    expect(s.size).toBe(0)
  })

  it('keeps push and pull_request runs of one workflow apart', () => {
    const s = findReplacedSuites([
      wr(1, 10, '.github/workflows/ci.yml', 'pull_request'),
      wr(2, 20, '.github/workflows/ci.yml', 'push')
    ])
    expect(s.size).toBe(0)
  })

  it('uses the run id, not the input order, to pick the newest', () => {
    const s = findReplacedSuites([wr(2, 20), wr(1, 10)])
    expect([...s]).toEqual([10])
  })
})

describe('dropReplacedCancellations', () => {
  // Observed on pkgdeps/automerge-gate-example#44: the replaced run left
  // a running job and a never-started `needs:` job, both `cancelled`.
  it('drops every cancelled job of a replaced run', () => {
    const runs = [
      cr(1, 10, 'slow', 'cancelled'),
      cr(2, 10, 'after', 'cancelled'),
      cr(3, 20, 'slow', 'success'),
      cr(4, 20, 'after', 'success')
    ]
    const r = dropReplacedCancellations(runs, new Set([10]))
    expect(r.kept.map((x) => x.id)).toEqual([3, 4])
    expect(r.dropped.map((x) => x.id)).toEqual([1, 2])
  })

  it('keeps a failure from a replaced run', () => {
    const runs = [cr(1, 10, 'lint', 'failure'), cr(2, 20, 'lint', 'skipped')]
    const r = dropReplacedCancellations(runs, new Set([10]))
    expect(r.kept.map((x) => x.id)).toEqual([1, 2])
  })

  it('keeps a cancelled run that no newer run replaced', () => {
    const runs = [cr(1, 10, 'lint', 'cancelled')]
    const r = dropReplacedCancellations(runs, new Set())
    expect(r.kept.map((x) => x.id)).toEqual([1])
  })
})

describe('pendingRunsWithoutJobs', () => {
  const ci = '.github/workflows/ci.yml'
  const gate = '.github/workflows/gate.yml'

  // Observed on pkgdeps/automerge-gate-example#45 with v5.0.2: the gate
  // polled while the newer run was queued with no jobs yet, and reported
  // success before that run's jobs appeared.
  it('returns a pending placeholder for an unfinished run with no jobs', () => {
    const p = pendingRunsWithoutJobs(
      [wr(2, 20, ci, 'pull_request', 'queued')],
      [],
      new Set(),
      gate
    )
    expect(p).toEqual([
      {
        id: -2,
        name: 'ci',
        status: 'queued',
        conclusion: null,
        details_url: 'https://github.com/o/r/actions/runs/2',
        app: { slug: 'github-actions' },
        suite_id: 20,
        workflow_path: ci
      }
    ])
  })

  it('skips a run whose jobs already exist', () => {
    const p = pendingRunsWithoutJobs(
      [wr(2, 20, ci, 'pull_request', 'in_progress')],
      [cr(1, 20, 'slow', null, 'in_progress')],
      new Set(),
      gate
    )
    expect(p).toEqual([])
  })

  it('skips a completed run', () => {
    const p = pendingRunsWithoutJobs([wr(2, 20)], [], new Set(), gate)
    expect(p).toEqual([])
  })

  it('skips a replaced run', () => {
    const p = pendingRunsWithoutJobs(
      [wr(1, 10, ci, 'pull_request', 'queued')],
      [],
      new Set([10]),
      gate
    )
    expect(p).toEqual([])
  })

  it("skips the gate's own workflow", () => {
    const p = pendingRunsWithoutJobs(
      [wr(3, 30, gate, 'pull_request', 'queued')],
      [],
      new Set(),
      gate
    )
    expect(p).toEqual([])
  })
})
