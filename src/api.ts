import type { AggregatedCheckRun } from './filter.js'
import type { WorkflowRunSummary } from './replaced-runs.js'

type CheckRunData = {
  id: number
  name: string
  status: string
  conclusion: string | null
  details_url: string
  app: { slug: string } | null
  check_suite: { id: number } | null
}

export type ReviewListItem = {
  state: string
  submitted_at: string | null
  user: { login: string } | null
  // GitHub's classification of the reviewer's relationship to the
  // repository. Used to skip reviews from drive-by users (CONTRIBUTOR /
  // NONE / FIRST_TIME_CONTRIBUTOR / MANNEQUIN) so a non-authorized
  // Approve doesn't satisfy the merge-intent gate.
  author_association: string
}

export type CreateCommitStatusParams = {
  owner: string
  repo: string
  sha: string
  state: 'error' | 'failure' | 'pending' | 'success'
  context: string
  description?: string
  target_url?: string
}

export type OctokitLike = {
  rest: {
    checks: {
      listForRef: (params: {
        owner: string
        repo: string
        ref: string
        filter?: 'latest' | 'all'
        per_page?: number
      }) => Promise<{ data: { check_runs: CheckRunData[] } }>
    }
    pulls: {
      listReviews: (params: {
        owner: string
        repo: string
        pull_number: number
        per_page?: number
      }) => Promise<{ data: ReviewListItem[] }>
    }
    repos: {
      createCommitStatus: (params: CreateCommitStatusParams) => Promise<unknown>
      getCollaboratorPermissionLevel: (params: {
        owner: string
        repo: string
        username: string
      }) => Promise<{
        data: {
          permission: 'admin' | 'write' | 'read' | 'none' | string
          role_name?: string
        }
      }>
    }
  }
  paginate: <T>(
    fn: (params: Record<string, unknown>) => Promise<{ data: T[] }>,
    params: Record<string, unknown>
  ) => Promise<T[]>
}

// Lists the latest check_runs for the given SHA as a flat
// AggregatedCheckRun[]. One paginated call covers every check_suite, so the
// cost per poll does not grow with the number of suites. `filter: 'latest'`
// keeps only the newest attempt of each check_run, the same set the
// per-suite endpoint returns. The run's app.slug is kept so downstream
// filters (filter.ts) can decide based on the originating GitHub App.
export const fetchAllCheckRuns = async (
  octokit: OctokitLike,
  owner: string,
  repo: string,
  sha: string
): Promise<AggregatedCheckRun[]> => {
  const checkRuns = await withRetry(
    () =>
      octokit.paginate<CheckRunData>(octokit.rest.checks.listForRef as never, {
        owner,
        repo,
        ref: sha,
        filter: 'latest',
        per_page: 100
      }),
    { retries: 3, baseDelayMs: 500 }
  )

  return checkRuns.map((r) => ({
    id: r.id,
    name: r.name,
    status: r.status,
    conclusion: r.conclusion,
    details_url: r.details_url,
    app: { slug: r.app?.slug ?? 'unknown' },
    suite_id: r.check_suite?.id ?? 0
  }))
}

// Returns a memoizing lookup for an actions run's workflow path. Used by
// self-exclusion to drop check_runs that belong to the same workflow file
// as the currently executing run (covers cancelled siblings etc.).
export const createWorkflowPathLookup = (
  octokit: OctokitLike,
  owner: string,
  repo: string
): ((runId: number) => Promise<string | null>) => {
  const cache = new Map<number, string | null>()
  return async (runId: number) => {
    if (cache.has(runId)) {
      return cache.get(runId) ?? null
    }
    try {
      const result = await withRetry(
        () =>
          (
            octokit as unknown as {
              rest: {
                actions: {
                  getWorkflowRun: (params: {
                    owner: string
                    repo: string
                    run_id: number
                  }) => Promise<{ data: { path: string } }>
                }
              }
            }
          ).rest.actions.getWorkflowRun({ owner, repo, run_id: runId }),
        { retries: 3, baseDelayMs: 500 }
      )
      const path = result.data.path
      cache.set(runId, path)
      return path
    } catch {
      cache.set(runId, null)
      return null
    }
  }
}

export const MISSING_ACTIONS_READ_MESSAGE =
  'cannot list workflow runs for this SHA. automerge-gate requires `actions: read` in the job permissions.'

// Thrown when GitHub refuses a request because of a rate limit, so callers
// can report it as such instead of as a missing permission.
export class RateLimitError extends Error {
  constructor(detail: string) {
    super(
      `GitHub API rate limit reached while listing workflow runs for this SHA: ${detail}`
    )
    this.name = 'RateLimitError'
  }
}

// GitHub answers a rate-limited request with 403 or 429. A primary limit
// sets `x-ratelimit-remaining: 0`; a secondary limit sets `retry-after` or
// says "rate limit" in the message.
// https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
export const isRateLimitError = (err: unknown): boolean => {
  const e = err as {
    status?: number
    message?: string
    response?: { headers?: Record<string, string | number | undefined> }
  }
  if (e.status === 429) return true
  if (e.status !== 403) return false
  const headers = e.response?.headers ?? {}
  if (String(headers['x-ratelimit-remaining']) === '0') return true
  if (headers['retry-after'] !== undefined) return true
  return /rate limit/i.test(e.message ?? '')
}

// Lists the GitHub Actions workflow runs for the SHA. Used to recognise
// runs that a newer run of the same workflow replaced (see replaced-runs.ts).
// Returns null when the token cannot read the Actions API (4xx, usually a
// missing `actions: read`) so the gate can fail with a clear message. A
// rate-limited request throws RateLimitError instead, because it says
// nothing about the permission.
// 5xx errors are retried and then thrown, like the check_run fetch, so the
// polling loop retries the whole iteration.
export const fetchWorkflowRuns = async (
  octokit: OctokitLike,
  owner: string,
  repo: string,
  sha: string
): Promise<WorkflowRunSummary[] | null> => {
  const listWorkflowRunsForRepo = (
    octokit as unknown as {
      rest: {
        actions: {
          listWorkflowRunsForRepo: (
            params: Record<string, unknown>
          ) => Promise<{
            data: { workflow_runs: WorkflowRunSummary[] }
          }>
        }
      }
    }
  ).rest.actions.listWorkflowRunsForRepo
  try {
    const runs = await withRetry(
      () =>
        octokit.paginate<WorkflowRunSummary>(listWorkflowRunsForRepo as never, {
          owner,
          repo,
          head_sha: sha,
          per_page: 100
        }),
      { retries: 3, baseDelayMs: 500 }
    )
    return runs.map((r) => ({
      id: r.id,
      name: r.name,
      path: r.path,
      event: r.event,
      status: r.status,
      check_suite_id: r.check_suite_id,
      html_url: r.html_url
    }))
  } catch (err) {
    if (isRateLimitError(err)) {
      throw new RateLimitError(err instanceof Error ? err.message : String(err))
    }
    const status = (err as { status?: number }).status
    if (status !== undefined && status < 500) return null
    throw err
  }
}

// Checks, before polling starts, that the workflow runs for the SHA can be
// listed. Returns the message to fail the job with, or null when polling
// can start. Without this check a missing permission or a rate limit would
// be retried as a failed poll until the job timed out. Other errors (5xx)
// return null: the polling loop retries them.
export const checkWorkflowRunsReadable = async (
  octokit: OctokitLike,
  owner: string,
  repo: string,
  sha: string
): Promise<string | null> => {
  try {
    const runs = await fetchWorkflowRuns(octokit, owner, repo, sha)
    return runs === null ? MISSING_ACTIONS_READ_MESSAGE : null
  } catch (err) {
    if (err instanceof RateLimitError) return err.message
    return null
  }
}

// Exponential backoff retry. Retries only on 5xx errors (or errors with
// no `status` property, treated as transient). 4xx errors throw immediately.
export const withRetry = async <T>(
  fn: () => Promise<T>,
  options: { retries: number; baseDelayMs: number }
): Promise<T> => {
  let lastErr: unknown
  for (let attempt = 0; attempt <= options.retries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      const status = (err as { status?: number }).status
      if (status !== undefined && status < 500) throw err
      if (attempt === options.retries) throw err
      const delay = options.baseDelayMs * 2 ** attempt
      await new Promise((r) => setTimeout(r, delay))
    }
  }
  throw lastErr
}
