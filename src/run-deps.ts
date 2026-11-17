import type { OctokitLike } from './api.js'
import type { ReviewState } from './mode.js'

export type RunContext = {
  eventName: string
  action: string
  pr: {
    number: number
    head: { sha: string }
    auto_merge: { enabled_by: { login: string } } | null
    /**
     * Set while the pull request belongs to a GitHub stack; `null` or
     * absent otherwise. `pull_request.opened` never carries it, because
     * a pull request joins a stack after it is created (the `stacked`
     * activity reports that).
     */
    stack?: { number: number; position: number; size: number } | null
  }
  reviewState: ReviewState | null
  before: string | undefined
  owner: string
  repo: string
}

export type RunEnv = {
  runId: number
  runAttempt: number
  serverUrl: string
  repository: string
  workflowRef: string | undefined
}

export type RunDeps = {
  octokit: OctokitLike
  context: RunContext
  env: RunEnv
}
