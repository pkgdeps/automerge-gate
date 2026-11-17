import { describe, it, expect, vi } from 'vitest'
import {
  fetchAllCheckRuns,
  isRateLimitError,
  withRetry,
  type OctokitLike
} from '../src/api.js'

describe('fetchAllCheckRuns', () => {
  const paginateRuns = async (fn: unknown, params: unknown) => {
    const res = await (fn as (p: unknown) => Promise<{ data: unknown }>)(params)
    return (res as { data: { check_runs: unknown[] } }).data.check_runs
  }

  it('lists the latest check runs for the ref in one paginated call', async () => {
    const listForRef = vi.fn().mockResolvedValue({
      data: {
        check_runs: [
          {
            id: 10,
            name: 'lint',
            status: 'completed',
            conclusion: 'success',
            details_url: '',
            app: { slug: 'github-actions' },
            check_suite: { id: 1 }
          },
          {
            id: 20,
            name: 'deploy',
            status: 'completed',
            conclusion: 'success',
            details_url: '',
            app: { slug: 'cloudflare-pages' },
            check_suite: { id: 2 }
          }
        ]
      }
    })
    const octokit = {
      rest: { checks: { listForRef }, repos: { createCommitStatus: vi.fn() } },
      paginate: vi.fn(paginateRuns)
    } as unknown as OctokitLike

    const result = await fetchAllCheckRuns(octokit, 'owner', 'repo', 'abc')

    expect(octokit.paginate).toHaveBeenCalledTimes(1)
    expect(listForRef).toHaveBeenCalledWith({
      owner: 'owner',
      repo: 'repo',
      ref: 'abc',
      filter: 'latest',
      per_page: 100
    })
    expect(result).toEqual([
      {
        id: 10,
        name: 'lint',
        status: 'completed',
        conclusion: 'success',
        details_url: '',
        app: { slug: 'github-actions' },
        suite_id: 1
      },
      {
        id: 20,
        name: 'deploy',
        status: 'completed',
        conclusion: 'success',
        details_url: '',
        app: { slug: 'cloudflare-pages' },
        suite_id: 2
      }
    ])
  })

  it('treats null app as "unknown" slug', async () => {
    const octokit = {
      rest: {
        checks: {
          listForRef: vi.fn().mockResolvedValue({
            data: {
              check_runs: [
                {
                  id: 10,
                  name: 'r',
                  status: 'completed',
                  conclusion: 'success',
                  details_url: '',
                  app: null,
                  check_suite: { id: 1 }
                }
              ]
            }
          })
        },
        repos: { createCommitStatus: vi.fn() }
      },
      paginate: paginateRuns
    } as unknown as OctokitLike

    const result = await fetchAllCheckRuns(octokit, 'o', 'r', 'sha')
    expect(result[0].app.slug).toBe('unknown')
  })

  it('retries on 5xx errors from paginate', async () => {
    const listForRef = vi.fn().mockResolvedValue({
      data: {
        check_runs: [
          {
            id: 100,
            name: 'r',
            status: 'completed',
            conclusion: 'success',
            details_url: '',
            app: { slug: 'github-actions' },
            check_suite: { id: 1 }
          }
        ]
      }
    })

    let paginateCalls = 0
    const octokit = {
      rest: { checks: { listForRef }, repos: { createCommitStatus: vi.fn() } },
      paginate: async (fn: unknown, params: unknown) => {
        paginateCalls++
        if (paginateCalls === 1) {
          throw { status: 503 }
        }
        return paginateRuns(fn, params)
      }
    } as unknown as OctokitLike

    const result = await fetchAllCheckRuns(octokit, 'o', 'r', 'sha')
    expect(result).toHaveLength(1)
    expect(paginateCalls).toBe(2)
  })

  it('does not retry on 4xx errors from paginate', async () => {
    const octokit = {
      rest: {
        checks: { listForRef: vi.fn() },
        repos: { createCommitStatus: vi.fn() }
      },
      paginate: vi.fn().mockRejectedValue({ status: 404 })
    } as unknown as OctokitLike

    await expect(fetchAllCheckRuns(octokit, 'o', 'r', 'sha')).rejects.toEqual({
      status: 404
    })
  })
})

describe('withRetry', () => {
  it('returns the value on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok')
    expect(await withRetry(fn, { retries: 3, baseDelayMs: 1 })).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('retries on 5xx errors', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce({ status: 500 })
      .mockRejectedValueOnce({ status: 502 })
      .mockResolvedValue('ok')
    expect(await withRetry(fn, { retries: 3, baseDelayMs: 1 })).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('does not retry on 4xx errors', async () => {
    const fn = vi.fn().mockRejectedValue({ status: 404 })
    await expect(withRetry(fn, { retries: 3, baseDelayMs: 1 })).rejects.toEqual(
      { status: 404 }
    )
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('gives up after the retry budget', async () => {
    const fn = vi.fn().mockRejectedValue({ status: 503 })
    await expect(withRetry(fn, { retries: 2, baseDelayMs: 1 })).rejects.toEqual(
      { status: 503 }
    )
    expect(fn).toHaveBeenCalledTimes(3)
  })
})

describe('isRateLimitError', () => {
  it('429 is a rate limit', () => {
    expect(isRateLimitError({ status: 429 })).toBe(true)
  })

  it('403 with x-ratelimit-remaining: 0 is a rate limit', () => {
    expect(
      isRateLimitError({
        status: 403,
        response: { headers: { 'x-ratelimit-remaining': '0' } }
      })
    ).toBe(true)
  })

  it('403 with retry-after is a rate limit', () => {
    expect(
      isRateLimitError({
        status: 403,
        response: { headers: { 'retry-after': '60' } }
      })
    ).toBe(true)
  })

  it('403 whose message mentions a rate limit is a rate limit', () => {
    expect(
      isRateLimitError({
        status: 403,
        message: 'You have exceeded a secondary rate limit.'
      })
    ).toBe(true)
  })

  it('403 for a missing permission is not a rate limit', () => {
    expect(
      isRateLimitError({
        status: 403,
        message: 'Resource not accessible by integration',
        response: { headers: { 'x-ratelimit-remaining': '4999' } }
      })
    ).toBe(false)
  })

  it('other statuses are not rate limits', () => {
    expect(isRateLimitError({ status: 404 })).toBe(false)
    expect(isRateLimitError({ status: 500 })).toBe(false)
    expect(isRateLimitError(new Error('network'))).toBe(false)
  })
})
