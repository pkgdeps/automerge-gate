import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import * as core from '@actions/core'
import { server } from './_msw/server.js'
import { buildDeps, buildInputs } from './_msw/fixtures.js'
import { runPublic } from '../src/gate-public.js'

const BASE = 'https://api.github.com'

// `runPublic` calls `core.summary.write()` which appends to
// $GITHUB_STEP_SUMMARY. We don't care about the actual file output here;
// stubbing the chained API to no-op keeps the tests hermetic.
const stubCoreSummary = (): void => {
  vi.spyOn(core.summary, 'write').mockResolvedValue(core.summary)
}

describe('runPublic', () => {
  beforeEach(() => {
    stubCoreSummary()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('any event → polling runs (suites endpoint hit), no POST/PATCH to check-runs', async () => {
    const suitesCalls: string[] = []
    const postBodies: Array<Record<string, unknown>> = []
    const patchIds: number[] = []
    server.use(
      http.get(
        `${BASE}/repos/:owner/:repo/commits/:sha/check-suites`,
        ({ params }) => {
          suitesCalls.push(params.sha as string)
          return HttpResponse.json({ total_count: 0, check_suites: [] })
        }
      ),
      http.post(
        `${BASE}/repos/:owner/:repo/check-runs`,
        async ({ request }) => {
          const body = (await request.json()) as Record<string, unknown>
          postBodies.push(body)
          return HttpResponse.json({
            ...body,
            id: 1,
            check_suite: { id: 1 },
            html_url: 'https://example.com'
          })
        }
      ),
      http.patch(`${BASE}/repos/:owner/:repo/check-runs/:id`, ({ params }) => {
        patchIds.push(Number(params.id))
        return HttpResponse.json({ id: Number(params.id) })
      })
    )

    const deps = buildDeps({
      eventName: 'pull_request',
      action: 'opened',
      pr: { number: 1, head: { sha: 'sha-head' }, auto_merge: null }
    })

    await runPublic(deps, buildInputs({ gateMode: 'public' }))

    // Polling reached the suites endpoint at least once.
    expect(suitesCalls.length).toBeGreaterThanOrEqual(1)
    expect(suitesCalls[0]).toBe('sha-head')
    // runPublic never writes its own check_run.
    expect(postBodies).toHaveLength(0)
    expect(patchIds).toHaveLength(0)
  })

  it('empty check list → polling exits success (no setFailed)', async () => {
    const setFailedSpy = vi
      .spyOn(core, 'setFailed')
      .mockImplementation(() => {})

    const deps = buildDeps()
    await runPublic(deps, buildInputs({ gateMode: 'public' }))

    expect(setFailedSpy).not.toHaveBeenCalled()
  })

  it('workflow rule in ignore-checks filters the matching workflow before aggregation', async () => {
    // Mirror of the gate-private wiring test: two check_runs share the
    // name "lint" from different workflow files; the failing one lives
    // in ci-go.yaml and a `workflow` rule filters it out, so the public
    // gate would normally call setFailed for the failing run but here
    // ends cleanly. Catches regressions in runPublic's pre-resolve →
    // applyFilters wiring that the unit tests cannot.
    const setFailedSpy = vi
      .spyOn(core, 'setFailed')
      .mockImplementation(() => {})
    const workflowLookups: number[] = []
    server.use(
      http.get(`${BASE}/repos/:owner/:repo/commits/:sha/check-suites`, () =>
        HttpResponse.json({
          total_count: 1,
          check_suites: [
            { id: 100, app: { slug: 'github-actions' }, status: 'completed' }
          ]
        })
      ),
      http.get(`${BASE}/repos/:owner/:repo/check-suites/:id/check-runs`, () =>
        HttpResponse.json({
          total_count: 2,
          check_runs: [
            {
              id: 1,
              name: 'lint',
              status: 'completed',
              conclusion: 'failure',
              details_url: 'https://github.com/o/r/actions/runs/1001/job/2001'
            },
            {
              id: 2,
              name: 'lint',
              status: 'completed',
              conclusion: 'success',
              details_url: 'https://github.com/o/r/actions/runs/1002/job/2002'
            }
          ]
        })
      ),
      http.get(`${BASE}/repos/:owner/:repo/actions/runs/:id`, ({ params }) => {
        const id = Number.parseInt(params.id as string, 10)
        workflowLookups.push(id)
        const path =
          id === 1001
            ? '.github/workflows/ci-go.yaml'
            : '.github/workflows/ci-python.yaml'
        return HttpResponse.json({ path })
      })
    )

    const deps = buildDeps()
    await runPublic(
      deps,
      buildInputs({
        gateMode: 'public',
        ignoreChecks: [{ workflow: 'ci-go.yaml', name: 'lint' }]
      })
    )

    // Both check_runs were resolved through the actions API.
    expect(workflowLookups.sort()).toEqual([1001, 1002])
    // Failure was filtered out by the workflow rule → no setFailed.
    expect(setFailedSpy).not.toHaveBeenCalled()
  })

  it('failing aggregate → core.setFailed is called', async () => {
    const setFailedSpy = vi
      .spyOn(core, 'setFailed')
      .mockImplementation(() => {})
    server.use(
      http.get(`${BASE}/repos/:owner/:repo/commits/:sha/check-suites`, () =>
        HttpResponse.json({
          total_count: 1,
          check_suites: [
            { id: 7, app: { slug: 'github-actions' }, status: 'completed' }
          ]
        })
      ),
      http.get(`${BASE}/repos/:owner/:repo/check-suites/:id/check-runs`, () =>
        HttpResponse.json({
          total_count: 1,
          check_runs: [
            {
              id: 71,
              name: 'lint',
              status: 'completed',
              conclusion: 'failure',
              details_url: ''
            }
          ]
        })
      )
    )

    const deps = buildDeps()
    await runPublic(deps, buildInputs({ gateMode: 'public' }))

    expect(setFailedSpy).toHaveBeenCalledTimes(1)
    expect(String(setFailedSpy.mock.calls[0][0])).toContain('failure')
  })
  describe('cancelled runs replaced by a newer run of the same workflow', () => {
    // Mirrors pkgdeps/automerge-gate-example#44: two pull_request events
    // on one SHA, cancel-in-progress cancelled the first run (suite 10).
    const useReplacedRun = (workflowRuns: () => Response) => {
      server.use(
        http.get(`${BASE}/repos/:owner/:repo/commits/:sha/check-suites`, () =>
          HttpResponse.json({
            total_count: 2,
            check_suites: [
              { id: 10, app: { slug: 'github-actions' }, status: 'completed' },
              { id: 20, app: { slug: 'github-actions' }, status: 'completed' }
            ]
          })
        ),
        http.get(
          `${BASE}/repos/:owner/:repo/check-suites/:id/check-runs`,
          ({ params }) => {
            const replaced = params.id === '10'
            const conclusion = replaced ? 'cancelled' : 'success'
            const base = replaced ? 1 : 3
            return HttpResponse.json({
              total_count: 2,
              check_runs: [
                {
                  id: base,
                  name: 'slow',
                  status: 'completed',
                  conclusion,
                  details_url: ''
                },
                {
                  id: base + 1,
                  name: 'after',
                  status: 'completed',
                  conclusion,
                  details_url: ''
                }
              ]
            })
          }
        ),
        http.get(`${BASE}/repos/:owner/:repo/actions/runs`, workflowRuns)
      )
    }

    it('ignores the cancelled jobs → success', async () => {
      const setFailedSpy = vi
        .spyOn(core, 'setFailed')
        .mockImplementation(() => {})
      const outputs: Record<string, string> = {}
      vi.spyOn(core, 'setOutput').mockImplementation((k, v) => {
        outputs[k] = String(v)
      })
      useReplacedRun(() =>
        HttpResponse.json({
          total_count: 2,
          workflow_runs: [
            {
              id: 101,
              path: '.github/workflows/probe.yml',
              event: 'pull_request',
              check_suite_id: 10
            },
            {
              id: 102,
              path: '.github/workflows/probe.yml',
              event: 'pull_request',
              check_suite_id: 20
            }
          ]
        })
      )

      await runPublic(buildDeps(), buildInputs({ gateMode: 'public' }))

      expect(setFailedSpy).not.toHaveBeenCalled()
      expect(outputs['state']).toBe('success')
      expect(outputs['evaluated-checks']).toBe('2')
    })

    it('without actions: read → warns and keeps the cancelled jobs', async () => {
      const setFailedSpy = vi
        .spyOn(core, 'setFailed')
        .mockImplementation(() => {})
      const warningSpy = vi.spyOn(core, 'warning').mockImplementation(() => {})
      useReplacedRun(() =>
        HttpResponse.json(
          { message: 'Resource not accessible by integration' },
          { status: 403 }
        )
      )

      await runPublic(buildDeps(), buildInputs({ gateMode: 'public' }))

      expect(setFailedSpy).toHaveBeenCalledTimes(1)
      expect(
        warningSpy.mock.calls.some((c) =>
          String(c[0]).includes('actions: read')
        )
      ).toBe(true)
    })
  })
})
