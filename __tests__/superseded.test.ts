import { describe, expect, it } from 'vitest'
import type { AggregatedCheckRun } from '../src/filter.js'
import {
  dropSupersededCancellations,
  findSupersededSuites,
  type WorkflowRunSummary
} from '../src/superseded.js'

const wr = (
  id: number,
  suite: number,
  path = '.github/workflows/ci.yml',
  event = 'pull_request'
): WorkflowRunSummary => ({ id, path, event, check_suite_id: suite })

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

describe('findSupersededSuites', () => {
  it('marks older runs of the same workflow and event', () => {
    const s = findSupersededSuites([wr(1, 10), wr(2, 20), wr(3, 30)])
    expect([...s].sort()).toEqual([10, 20])
  })

  it('keeps runs of different workflows apart', () => {
    const s = findSupersededSuites([
      wr(1, 10, '.github/workflows/a.yml'),
      wr(2, 20, '.github/workflows/b.yml')
    ])
    expect(s.size).toBe(0)
  })

  it('keeps push and pull_request runs of one workflow apart', () => {
    const s = findSupersededSuites([
      wr(1, 10, '.github/workflows/ci.yml', 'pull_request'),
      wr(2, 20, '.github/workflows/ci.yml', 'push')
    ])
    expect(s.size).toBe(0)
  })

  it('uses the run id, not the input order, to pick the newest', () => {
    const s = findSupersededSuites([wr(2, 20), wr(1, 10)])
    expect([...s]).toEqual([10])
  })
})

describe('dropSupersededCancellations', () => {
  // Observed on pkgdeps/automerge-gate-example#44: the replaced run left
  // a running job and a never-started `needs:` job, both `cancelled`.
  it('drops every cancelled job of a replaced run', () => {
    const runs = [
      cr(1, 10, 'slow', 'cancelled'),
      cr(2, 10, 'after', 'cancelled'),
      cr(3, 20, 'slow', 'success'),
      cr(4, 20, 'after', 'success')
    ]
    const r = dropSupersededCancellations(runs, new Set([10]))
    expect(r.kept.map((x) => x.id)).toEqual([3, 4])
    expect(r.dropped.map((x) => x.id)).toEqual([1, 2])
  })

  it('keeps a failure from a replaced run', () => {
    const runs = [cr(1, 10, 'lint', 'failure'), cr(2, 20, 'lint', 'skipped')]
    const r = dropSupersededCancellations(runs, new Set([10]))
    expect(r.kept.map((x) => x.id)).toEqual([1, 2])
  })

  it('keeps a cancelled run that no newer run replaced', () => {
    const runs = [cr(1, 10, 'lint', 'cancelled')]
    const r = dropSupersededCancellations(runs, new Set())
    expect(r.kept.map((x) => x.id)).toEqual([1])
  })
})
