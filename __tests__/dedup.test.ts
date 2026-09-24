import { describe, it, expect } from 'vitest'
import { dropSupersededCancellations } from '../src/dedup.js'
import { aggregate } from '../src/aggregator.js'
import type { AggregatedCheckRun } from '../src/filter.js'

// Unlike filter.test.ts's factory, ids and suites must vary here — the
// whole subject under test is "which of several same-named runs wins".
// Default: a completed+success github-actions run with a resolved
// workflow path; suite_id defaults to id so cross-suite duplicates just
// need distinct ids.
const make = (o: {
  id: number
  name: string
  app?: string
  suite?: number
  status?: string
  conclusion?: string | null
  workflowPath?: string | null
}): AggregatedCheckRun => ({
  id: o.id,
  name: o.name,
  status: o.status ?? 'completed',
  conclusion: o.conclusion === undefined ? 'success' : o.conclusion,
  details_url: '',
  app: { slug: o.app ?? 'github-actions' },
  suite_id: o.suite ?? o.id,
  workflow_path:
    o.workflowPath === undefined ? '.github/workflows/ci.yaml' : o.workflowPath
})

describe('dropSupersededCancellations', () => {
  it('is a no-op when no rules are configured', () => {
    const runs = [
      make({ id: 1, name: 'build', conclusion: 'cancelled' }),
      make({ id: 2, name: 'build' })
    ]
    const result = dropSupersededCancellations(runs, [])
    expect(result.kept).toBe(runs)
    expect(result.dropped).toEqual([])
  })

  it('drops a cancelled run superseded by a newer cross-suite duplicate', () => {
    // The motivating cancel-in-progress shape: same workflow, same job
    // name, two suites on one SHA — the older run cancelled, the newer
    // one green.
    const cancelled = make({ id: 10, name: 'build', conclusion: 'cancelled' })
    const fresh = make({ id: 20, name: 'build' })
    const result = dropSupersededCancellations(
      [cancelled, fresh],
      [{ workflow: 'ci.yaml' }]
    )
    expect(result.kept).toEqual([fresh])
    expect(result.dropped).toEqual([{ run: cancelled, supersededBy: fresh }])
  })

  it('drops only the cancelled runs out of a three-run group', () => {
    const runs = [
      make({ id: 5, name: 'build', conclusion: 'cancelled' }),
      make({ id: 9, name: 'build' }),
      make({ id: 7, name: 'build', conclusion: 'failure' })
    ]
    const result = dropSupersededCancellations(runs, [{ workflow: 'ci.yaml' }])
    expect(result.kept.map((r) => r.id)).toEqual([9, 7])
    expect(result.dropped.map((d) => d.run.id)).toEqual([5])
    expect(result.dropped.map((d) => d.supersededBy.id)).toEqual([9])
    expect(aggregate(result.kept).state).toBe('failure')
  })

  it('keeps an older failure when a newer run skipped the job', () => {
    // A later event (e.g. `labeled`) re-runs the workflow and the job's
    // `if:` skips it. `skipped` is green, so dropping the older failure
    // would let the gate pass on a failure nobody fixed.
    const failed = make({ id: 1, name: 'test', conclusion: 'failure' })
    const skipped = make({ id: 2, name: 'test', conclusion: 'skipped' })
    const result = dropSupersededCancellations(
      [failed, skipped],
      [{ app: 'github-actions' }]
    )
    expect(result.kept).toEqual([failed, skipped])
    expect(result.dropped).toEqual([])
    expect(aggregate(result.kept).state).toBe('failure')
  })

  it.each(['failure', 'timed_out', 'action_required'])(
    'keeps an older %s run even when a newer run succeeded',
    (conclusion) => {
      const older = make({ id: 1, name: 'test', conclusion })
      const newer = make({ id: 2, name: 'test' })
      const result = dropSupersededCancellations(
        [older, newer],
        [{ app: 'github-actions' }]
      )
      expect(result.kept).toEqual([older, newer])
      expect(aggregate(result.kept).state).toBe('failure')
    }
  )

  it('keeps the newest run when it is itself cancelled', () => {
    const older = make({ id: 1, name: 'build', conclusion: 'cancelled' })
    const newer = make({ id: 2, name: 'build', conclusion: 'cancelled' })
    const result = dropSupersededCancellations(
      [older, newer],
      [{ workflow: 'ci.yaml' }]
    )
    expect(result.kept).toEqual([newer])
    expect(result.dropped).toEqual([{ run: older, supersededBy: newer }])
    expect(aggregate(result.kept).state).toBe('failure')
  })

  it('keeps a lone cancelled run that nothing superseded', () => {
    const cancelled = make({ id: 1, name: 'build', conclusion: 'cancelled' })
    const result = dropSupersededCancellations(
      [cancelled],
      [{ workflow: 'ci.yaml' }]
    )
    expect(result.kept).toEqual([cancelled])
    expect(result.dropped).toEqual([])
  })

  it('keeps a re-run of an older suite that failed after a newer suite succeeded', () => {
    // Re-running the older suite creates a check_run with the highest id.
    // Its failure is not a cancellation, so it stays and the gate is red.
    const newerSuiteRun = make({ id: 10, name: 'build', suite: 200 })
    const rerunOfOlderSuite = make({
      id: 20,
      name: 'build',
      suite: 100,
      conclusion: 'failure'
    })
    const result = dropSupersededCancellations(
      [newerSuiteRun, rerunOfOlderSuite],
      [{ workflow: 'ci.yaml' }]
    )
    expect(result.kept).toEqual([newerSuiteRun, rerunOfOlderSuite])
    expect(aggregate(result.kept).state).toBe('failure')
  })

  it('does not collapse same-named runs from different workflows', () => {
    // Monorepo pattern: two workflows each define a `lint` job. Both are
    // genuinely distinct checks and must both stay evaluated even when an
    // app-wide rule matches them.
    const goLint = make({
      id: 1,
      name: 'lint',
      workflowPath: '.github/workflows/ci-go.yaml'
    })
    const pyLint = make({
      id: 2,
      name: 'lint',
      conclusion: 'failure',
      workflowPath: '.github/workflows/ci-python.yaml'
    })
    const result = dropSupersededCancellations(
      [goLint, pyLint],
      [{ app: 'github-actions' }]
    )
    expect(result.kept).toEqual([goLint, pyLint])
    expect(result.dropped).toEqual([])
  })

  it('leaves unmatched duplicates untouched', () => {
    const runs = [
      make({ id: 1, name: 'build', conclusion: 'cancelled' }),
      make({ id: 2, name: 'build' })
    ]
    const result = dropSupersededCancellations(runs, [
      { workflow: 'nightly.yaml' }
    ])
    expect(result.kept).toEqual(runs)
    expect(result.dropped).toEqual([])
  })

  it('scopes dedup to the workflow named by the rule', () => {
    const ciOld = make({ id: 1, name: 'test', conclusion: 'cancelled' })
    const ciNew = make({ id: 2, name: 'test' })
    const nightlyOld = make({
      id: 3,
      name: 'test',
      conclusion: 'cancelled',
      workflowPath: '.github/workflows/nightly.yaml'
    })
    const nightlyNew = make({
      id: 4,
      name: 'test',
      workflowPath: '.github/workflows/nightly.yaml'
    })
    const result = dropSupersededCancellations(
      [ciOld, ciNew, nightlyOld, nightlyNew],
      [{ workflow: 'ci.yaml' }]
    )
    expect(result.kept).toEqual([ciNew, nightlyOld, nightlyNew])
    expect(result.dropped).toEqual([{ run: ciOld, supersededBy: ciNew }])
  })

  it('dedups third-party app runs by (app, name)', () => {
    // Third-party Checks have no workflow file — a null path is genuinely
    // N/A rather than unresolved, so (app, name) grouping is correct.
    const old = make({
      id: 1,
      name: 'Build',
      app: 'xcode-cloud',
      conclusion: 'cancelled',
      workflowPath: null
    })
    const fresh = make({
      id: 2,
      name: 'Build',
      app: 'xcode-cloud',
      workflowPath: null
    })
    const result = dropSupersededCancellations(
      [old, fresh],
      [{ app: 'xcode-cloud' }]
    )
    expect(result.kept).toEqual([fresh])
    expect(result.dropped).toEqual([{ run: old, supersededBy: fresh }])
  })

  it('never pools a github-actions run with an unresolvable (null) path', () => {
    // e.g. token lacks `actions: read`: grouping would degrade to
    // (app, name) and could collapse distinct same-named checks, so both
    // runs stay evaluated instead.
    const runs = [
      make({
        id: 1,
        name: 'build',
        conclusion: 'cancelled',
        workflowPath: null
      }),
      make({ id: 2, name: 'build', workflowPath: null })
    ]
    const result = dropSupersededCancellations(runs, [
      { app: 'github-actions' }
    ])
    expect(result.kept).toEqual(runs)
    expect(result.dropped).toEqual([])
  })

  it('never pools a github-actions run with an unresolved (undefined) path', () => {
    const old = make({ id: 1, name: 'build', conclusion: 'cancelled' })
    const fresh = make({ id: 2, name: 'build' })
    delete old.workflow_path
    delete fresh.workflow_path
    const result = dropSupersededCancellations(
      [old, fresh],
      [{ app: 'github-actions' }]
    )
    expect(result.kept).toEqual([old, fresh])
    expect(result.dropped).toEqual([])
  })

  it('keeps a pending latest run so the aggregate stays pending', () => {
    // The live cancel-in-progress race: the superseded run is already
    // cancelled while its replacement is still running. Dedup must keep
    // the replacement so polling continues instead of failing on the
    // cancellation.
    const cancelled = make({ id: 1, name: 'build', conclusion: 'cancelled' })
    const running = make({
      id: 2,
      name: 'build',
      status: 'in_progress',
      conclusion: null
    })
    const result = dropSupersededCancellations(
      [cancelled, running],
      [{ workflow: 'ci.yaml' }]
    )
    expect(result.kept).toEqual([running])
    expect(aggregate(result.kept).state).toBe('pending')
  })

  it('preserves input order, with winners at their original positions', () => {
    const a = make({ id: 1, name: 'other' })
    const oldBuild = make({ id: 2, name: 'build', conclusion: 'cancelled' })
    const b = make({ id: 3, name: 'another' })
    const newBuild = make({ id: 4, name: 'build' })
    const result = dropSupersededCancellations(
      [a, oldBuild, b, newBuild],
      [{ app: 'github-actions', name: 'build' }]
    )
    expect(result.kept).toEqual([a, b, newBuild])
  })

  it('AND-evaluates rule fields when selecting the pool', () => {
    // Only xcode-cloud's Build duplicates collapse; github-actions'
    // same-named duplicates don't match the rule and stay untouched.
    const xcodeOld = make({
      id: 1,
      name: 'Build',
      app: 'xcode-cloud',
      conclusion: 'cancelled',
      workflowPath: null
    })
    const xcodeNew = make({
      id: 2,
      name: 'Build',
      app: 'xcode-cloud',
      workflowPath: null
    })
    const actionsOld = make({ id: 3, name: 'Build', conclusion: 'cancelled' })
    const actionsNew = make({ id: 4, name: 'Build' })
    const result = dropSupersededCancellations(
      [xcodeOld, xcodeNew, actionsOld, actionsNew],
      [{ app: 'xcode-cloud', name: 'Build' }]
    )
    expect(result.kept).toEqual([xcodeNew, actionsOld, actionsNew])
    expect(result.dropped).toEqual([{ run: xcodeOld, supersededBy: xcodeNew }])
  })
})
