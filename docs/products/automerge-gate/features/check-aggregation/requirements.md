# Check aggregation

[日本語](requirements.ja.md)

## About this document

Check aggregation collects the check runs on a pull request's head commit and polls them until they give one aggregated verdict, `success` or `failure`.
The parent Product is [automerge-gate](../../product.md).

### Scope

- Which results on the head commit are evaluated.
- How one check run is read as passing, failing, or pending.
- How the check runs are combined into the aggregated verdict.
- Polling: the interval, when it ends, and what bounds it.
- Excluding the gate's own workflow from the evaluation.
- The action's outputs.

### Out of scope

- When polling starts and how the verdict is reported. See [Gate modes](../gate-modes/requirements.md).
- What the job log and step summary show. See [Check results log](../check-results-log/requirements.md).
- The matching rules of `ignore-checks`. That feature's Requirements are not yet written; this document only states where the rules apply.
- Which results of a replaced run are ignored. The Requirements of "Cancelled runs replaced by a newer run" are not yet written; this document only states where that step applies.
- Legacy commit statuses written by other tools. They are not evaluated.

## User stories

### Wait for every check on the head commit

As a maintainer, I want the gate to wait for every check on the pull request, whichever workflow or GitHub App reports it, so that I do not list checks by name.

**Acceptance criteria:**

Scenario: When every evaluated check has finished and passed, the verdict is success

- Given: The head commit has check runs from two workflow files and one GitHub App, all completed with `success`, `skipped`, or `neutral`.
- When: The gate polls.
- Then: Polling ends on that poll with the verdict `success`.

Scenario: When a check is still running, the gate keeps polling

- Given: One check run on the head commit is `in_progress` and the others have passed.
- When: The gate polls.
- Then: The gate reports no verdict, waits for the poll interval, and polls again.

Scenario: When a check has failed and another is still running, the gate keeps polling

- Given: One check run has completed with `failure` and another is `queued`.
- When: The gate polls.
- Then: The gate reports no verdict until the queued check run completes, and then ends with the verdict `failure`.

Scenario: When a check finishes with a conclusion other than success, skipped, or neutral, the verdict is failure

- Given: Every check run has completed, and one has the conclusion `cancelled`, `timed_out`, `action_required`, or `failure`.
- When: The gate polls.
- Then: Polling ends with the verdict `failure`.

Scenario: When the head commit has no check to evaluate, the verdict is success

- Given: The head commit has no check runs other than those of the gate's own workflow, and no unfinished workflow run.
- When: The gate polls.
- Then: Polling ends on the first poll with the verdict `success`.

Scenario: When a workflow run has started but has no jobs yet, the gate waits for it

- Given: A workflow run on the head commit is queued and has no check runs yet, and every existing check run has passed.
- When: The gate polls.
- Then: The gate counts the workflow run as one pending check and keeps polling until its jobs appear and finish.

### Do not wait for the gate itself

As a maintainer, I want the gate to leave its own workflow out so that it does not wait for itself.

**Acceptance criteria:**

Scenario: When the gate job is running, its own check run is not evaluated

- Given: The gate job's check run on the head commit is `in_progress`, and every other check run has passed.
- When: The gate polls.
- Then: Polling ends with the verdict `success`.

Scenario: When an earlier run of the gate workflow was cancelled on the same commit, it is not evaluated

- Given: The head commit has a `cancelled` check run from an earlier run of the gate's workflow file, and every other check run has passed.
- When: The gate polls.
- Then: Polling ends with the verdict `success`.

### Bound polling with the job timeout

As a maintainer, I want one place to limit how long the gate waits so that there are no two timeouts to keep in step.

**Acceptance criteria:**

Scenario: When checks do not finish before the job's timeout, the job ends without a verdict

- Given: The gate job has `timeout-minutes: 10`, and one check run stays `in_progress` for longer.
- When: Ten minutes pass.
- Then: GitHub ends the gate job, and the gate reports no verdict and sets no output.

Scenario: When reading the checks fails during polling, the gate retries on the next poll

- Given: The gate is polling, and GitHub answers one request for check runs with a server error after the retries.
- When: That poll fails.
- Then: The job log shows a warning with the error, and the gate polls again after the poll interval.

Scenario: When GitHub's rate limit is reached before polling starts, the job fails with a rate limit message

- Given: The token has `actions: read`, and GitHub refuses the request for the head commit's workflow runs because the rate limit is reached.
- When: The gate is about to start polling.
- Then: The job fails with a message that says the GitHub API rate limit was reached and does not mention `actions: read`, and no poll happens.

Scenario: When `poll-interval-seconds` is not a positive integer, the job fails

- Given: The workflow passes `poll-interval-seconds: '0'`.
- When: The gate starts.
- Then: The job fails with a message that the input must be a positive integer, and nothing is polled.

## KPIs

None. No measurement of this feature is recorded.

## Functional requirements

### Evaluated checks

**Overview:** On every poll the gate builds the list of checks to evaluate for the head commit.

**Input:** The head commit of the pull request, the `ignore-checks` input, and the gate's own workflow file.

**Output:** The evaluated checks for that poll.

#### Applicable conditions

##### Sources

The list starts from every check run on the head commit, from GitHub Actions and from GitHub Apps alike.
When a check run was re-run, only its latest attempt is used.
Each workflow run on the head commit that has not finished and has no check runs yet adds one pending check named after the workflow.

##### Exclusions

The following are removed, in this order.

1. Results of a replaced run that the feature "Cancelled runs replaced by a newer run" ignores.
2. Checks that match an `ignore-checks` rule.
3. Check runs from GitHub Actions that belong to the gate's own workflow file, from the current run and from earlier runs on the same commit. A workflow run of the gate's own workflow file that has no jobs yet is not added as a pending check either.

##### Not evaluated

Legacy commit statuses are not read. A CI that reports only through commit statuses has to be registered as a separate required check.

### Reading one check

**Overview:** Each evaluated check is read as passing, failing, or pending.

**Input:** The check run's status and conclusion.

**Output:**

| Status and conclusion | Reading |
| --- | --- |
| Status is not `completed` | Pending |
| `completed` without a conclusion | Pending |
| `completed` with `success`, `skipped`, or `neutral` | Passing |
| `completed` with any other conclusion, including ones unknown to the gate | Failing |

### Aggregated verdict

**Overview:** The readings are combined into one state per poll.

**Input:** The readings of the evaluated checks.

**Output:** `pending` when any check is pending; otherwise `failure` when any check is failing; otherwise `success`. An empty list gives `success`.

### Polling

**Overview:** The gate repeats the evaluation until the state is `success` or `failure`.

**Input:** `poll-interval-seconds` (default `30`): a positive integer.

**Output:** The aggregated verdict and the number of polls.

#### Applicable conditions

##### Interval

The first poll happens immediately. After a poll that is `pending` or that failed, the gate waits for the interval before the next one.

##### End

Polling ends only with `success` or `failure`. The action has no timeout input; the job's `timeout-minutes` is the only bound.

#### Exceptional behavior

##### A poll fails

When reading from GitHub fails during a poll, the gate logs a warning and tries again on the next poll, without limit.

##### Workflow runs cannot be listed

Before the first poll the gate checks that it can list the workflow runs of the head commit.
When GitHub refuses that request because of a rate limit, the job fails with a message that says the rate limit was reached, and polling does not start.
When GitHub refuses it for any other reason, the job fails with a message that names the `actions: read` permission, and polling does not start.

##### A rate limit is reached during polling

A poll that is refused because of a rate limit is a failed poll: the warning carries the rate limit message, and the gate tries again on the next poll.

### Action outputs

**Overview:** After polling, the action sets outputs that describe the result.

**Output:**

| Output | Meaning |
| --- | --- |
| `state` | The aggregated verdict, `success` or `failure`. `skipped` when private mode skips |
| `total-checks` | Number of check runs read on the last poll, before any exclusion |
| `evaluated-checks` | Number of evaluated checks on the last poll |
| `completed-checks` | Number of evaluated checks that had completed on the last poll |
| `polled-iterations` | Number of polls |

When private mode skips, `state` is `skipped` and the other outputs are `0`, as described in [Gate modes](../gate-modes/requirements.md). No output is set when the job fails before a verdict or is ended by its timeout.

## Data requirements

### Required data

- **Check runs:** Name, status, conclusion, link, originating GitHub App, and check suite of each check run on the head commit. Read on every poll; not stored.
- **Workflow runs:** Workflow name, workflow file, event, status, check suite, and link of each workflow run on the head commit. Read on every poll; not stored.

### Relationships

A check run from GitHub Actions belongs to one workflow run, and each workflow run has its own check suite.

### Personal information

None.

## External service dependencies

- **GitHub**
  - **Related user stories:** All.
  - **Reason for dependency:** The check runs and workflow runs are GitHub's.
  - **Contractual and usage decisions:** Every poll makes API requests with the workflow's token and counts toward that token's rate limit. The gate job holds a runner for as long as it polls.

## Security considerations

The token needs `checks: read` and `actions: read`. Aggregation writes nothing.

## Open questions

- **Unconfirmed: ending the job when a rate limit is reached during polling.** A rate limit before polling fails the job; one during polling is retried on the next poll. Whether polling should also end with the rate limit error is undecided. azu decides.
