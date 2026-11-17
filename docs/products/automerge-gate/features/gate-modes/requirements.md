# Gate modes

[日本語](requirements.ja.md)

## About this document

A gate mode decides when the gate evaluates a pull request and how the aggregated verdict reaches the required check.
Private mode evaluates only when merge intent exists and writes the verdict as a commit status.
Public mode evaluates on every triggering event and reports the verdict as the result of the gate job.
The parent Product is [automerge-gate](../../product.md).

### Scope

- Choosing the gate mode with the `gate-mode` input.
- The events the gate accepts.
- In private mode, deciding between polling and skipping from merge intent.
- In private mode, polling a pull request in a stack without waiting for merge intent, when the `poll-on-stacked-pull-requests` input is on.
- Reporting the aggregated verdict to the required check in each mode.

### Out of scope

- How check runs are collected and turned into an aggregated verdict. See [Check aggregation](../check-aggregation/requirements.md).
- What the job log and step summary show. See [Check results log](../check-results-log/requirements.md).
- Merging the pull request. GitHub's native auto-merge does that.
- Merge queue (`merge_group` events). It is not supported.
- Merging a stack. GitHub does that, and the gate does not look at the other pull requests in the stack.

## User stories

### Gate only pull requests with merge intent

As a maintainer of an internal repository, I want the gate to poll only pull requests that someone intends to merge so that other pull requests do not hold a runner.

**Acceptance criteria:**

Scenario: When auto-merge is enabled on a pull request, the gate polls and writes the verdict as a commit status

- Given: The gate runs in private mode, and every other check on the head commit passes.
- When: A maintainer enables auto-merge on the pull request.
- Then: The head commit gets a commit status whose context is the configured `context` and whose state is `success`, and the gate job succeeds.

Scenario: When a check fails on a pull request with merge intent, the commit status is failure

- Given: The gate runs in private mode, and one check on the head commit has failed.
- When: A maintainer enables auto-merge on the pull request.
- Then: The head commit gets a commit status with state `failure` for the configured context, and the gate job fails.

Scenario: When a commit is pushed without merge intent, no commit status is written

- Given: The gate runs in private mode, auto-merge is off, and the pull request has no active Approve review from a reviewer with write access.
- When: A commit is pushed to the pull request.
- Then: The gate job succeeds without polling, no commit status is written, and the step summary and the `state` output show `skipped`.

Scenario: When a commit is pushed while auto-merge is enabled, the new head commit is evaluated

- Given: The gate runs in private mode, and auto-merge is already enabled on the pull request.
- When: A commit is pushed to the pull request.
- Then: The gate polls the checks of the new head commit and writes a commit status on that commit.

Scenario: When auto-merge is disabled while the gate is polling, the gate still writes the verdict

- Given: The gate runs in private mode and is polling after auto-merge was enabled.
- When: A maintainer disables auto-merge before the checks finish.
- Then: The gate keeps polling and writes the commit status when the checks finish.

### Treat an Approve review as merge intent

As a maintainer of an internal repository, I want an Approve review from someone with write access to start the gate so that an approved pull request becomes mergeable without enabling auto-merge.

**Acceptance criteria:**

Scenario: When a reviewer with write access approves, the gate polls

- Given: The gate runs in private mode, the workflow listens to `pull_request_review`, and auto-merge is off.
- When: A reviewer with write access submits an Approve review.
- Then: The gate polls the checks and writes a commit status on the head commit.

Scenario: When a reviewer without write access approves, the gate skips

- Given: The gate runs in private mode, and no reviewer with write access has an active Approve review.
- When: A user with read access, or a user who is not a collaborator, submits an Approve review.
- Then: The gate job succeeds without polling, and no commit status is written.

Scenario: When a commit is pushed to a pull request with an active Approve review, the new head commit is evaluated

- Given: The gate runs in private mode, auto-merge is off, and a reviewer with write access has an active Approve review.
- When: A commit is pushed to the pull request.
- Then: The gate polls the checks of the new head commit and writes a commit status on that commit.

Scenario: When the only Approve review was dismissed or replaced by a request for changes, a push is skipped

- Given: The gate runs in private mode, auto-merge is off, and the only approving reviewer's latest review other than a comment is a dismissal or a request for changes.
- When: A commit is pushed to the pull request.
- Then: The gate job succeeds without polling, and no commit status is written.

Scenario: When a review that is not an Approve is submitted, the gate skips

- Given: The gate runs in private mode.
- When: A reviewer submits a comment review or a request for changes.
- Then: The gate job succeeds without polling, and no commit status is written.

### Gate pull requests in a stack

As a maintainer who merges stacks of pull requests, I want every pull request in a stack to get a verdict without waiting for merge intent so that the stack can merge.

**Acceptance criteria:**

Scenario: When a pull request joins a stack, the gate polls without merge intent

- Given: The gate runs in private mode with `poll-on-stacked-pull-requests: 'true'`, the workflow listens to the `stacked` activity type, auto-merge is off, and the pull request has no Approve review.
- When: The pull request is added to a stack.
- Then: The gate polls the checks and writes a commit status on the head commit, and the job log shows the stack number and the pull request's position in the stack.

Scenario: When a commit is pushed to a pull request in a stack, the new head commit is evaluated

- Given: The gate runs in private mode with `poll-on-stacked-pull-requests: 'true'`, the pull request is in a stack, auto-merge is off, and the pull request has no Approve review.
- When: A commit is pushed to the pull request.
- Then: The gate polls the checks of the new head commit and writes a commit status on that commit.

Scenario: When auto-merge is enabled on a stack while the gate is polling, the stack merges after the verdict

- Given: The gate runs in private mode with `poll-on-stacked-pull-requests: 'true'`, every pull request in a stack is polling, and one check is still running.
- When: A maintainer enables auto-merge on the stack, and the running check later passes.
- Then: The gate writes a `success` commit status on each head commit, and GitHub merges the stack without the gate being started again.

Scenario: When a pull request is opened and is not in a stack yet, the gate skips

- Given: The gate runs in private mode with `poll-on-stacked-pull-requests: 'true'`, and auto-merge is off.
- When: A pull request is opened.
- Then: The gate job succeeds without polling, and no commit status is written.

Scenario: When a pull request is not in a stack, the input changes nothing

- Given: The gate runs in private mode with `poll-on-stacked-pull-requests: 'true'`, the pull request is not in a stack, auto-merge is off, and the pull request has no Approve review.
- When: A commit is pushed to the pull request.
- Then: The gate job succeeds without polling, and no commit status is written.

Scenario: When the input is off, a pull request in a stack waits for merge intent

- Given: The gate runs in private mode without `poll-on-stacked-pull-requests`, the pull request is in a stack, auto-merge is off, and the pull request has no Approve review.
- When: A commit is pushed to the pull request.
- Then: The gate job succeeds without polling, and no commit status is written.

### Gate fork pull requests with a read-only token

As a maintainer of a repository that accepts fork pull requests, I want the gate to work with read permissions only so that fork pull requests are gated the same way as others.

**Acceptance criteria:**

Scenario: When every check passes in public mode, the gate job succeeds

- Given: The gate runs in public mode, and every other check on the head commit passes.
- When: A pull request event starts the gate workflow.
- Then: The gate job succeeds, and the gate writes no commit status and no check run.

Scenario: When a check fails in public mode, the gate job fails

- Given: The gate runs in public mode, and one check on the head commit has failed.
- When: A pull request event starts the gate workflow.
- Then: The gate job fails with a message that the aggregated state is failure.

Scenario: When a pull request has no merge intent in public mode, the gate still polls

- Given: The gate runs in public mode, auto-merge is off, and the pull request has no Approve review.
- When: A commit is pushed to the pull request.
- Then: The gate polls the checks of the head commit and ends with the aggregated verdict.

### Fail clearly on a wrong setup

As a maintainer setting up the gate, I want a wrong configuration to be reported so that I do not mistake a gate that does nothing for a passing one.

**Acceptance criteria:**

Scenario: When `gate-mode` is not `private` or `public`, the job fails with the allowed values

- Given: The workflow passes `gate-mode: main`, or omits the input.
- When: The gate starts.
- Then: The job fails with a message that `gate-mode` must be `private` or `public`, and nothing is polled or written.

Scenario: When `poll-on-stacked-pull-requests` is not `true` or `false`, the job fails with the allowed values

- Given: The workflow passes `poll-on-stacked-pull-requests: 'yes'`.
- When: The gate starts.
- Then: The job fails with a message that the input must be `true` or `false`, and nothing is polled or written.

Scenario: When the token cannot list workflow runs, the job fails before polling

- Given: The job's permissions lack `actions: read`, and the event would start polling.
- When: The gate starts.
- Then: The job fails with a message that names `actions: read`, and in private mode no commit status is written.

Scenario: When the workflow is started by an event other than a pull request event, the job fails

- Given: The gate workflow is started by `push`, in either gate mode.
- When: The gate starts.
- Then: The job fails with a message that only `pull_request` and `pull_request_review` are handled and that names `push`, and nothing is polled or written.

## KPIs

None. No measurement of this feature is recorded.

## Functional requirements

### Mode selection

**Overview:** The `gate-mode` input selects private or public mode for the whole run.

**Input:** `gate-mode` (required): `private` or `public`.

**Output:** The run follows the selected mode. Any other value, including an empty one, fails the job before anything else happens. The message also says how the former `gate: main` and `gate: fork` values map to the two modes.

### Accepted events

**Overview:** The gate handles `pull_request` and `pull_request_review` events and reads the pull request and its head commit from the event.

**Input:** The event that started the workflow.

**Output:** For any other event the job fails with a message that names the event, and nothing is polled or written. When the event carries no pull request, the job fails.

A gate that did nothing must not look like a gate that passed: in public mode a job that ends successfully is a passing required check. There is no use for the gate outside pull request events.

### Merge intent decision in private mode

**Overview:** In private mode the gate decides, once at the start of the run, whether to poll or to skip.

**Input:** The event, its activity type, the review state for review events, whether auto-merge is enabled on the pull request at the time of the event, the pull request's reviews, the `poll-on-stacked-pull-requests` input, and whether the event says the pull request is in a stack.

**Output:** Polling or skipping, with the reason written to the job log.

#### Applicable conditions

##### Events that start polling

| Event | Condition | Result |
| --- | --- | --- |
| `pull_request` with `auto_merge_enabled` | Always | Poll |
| `pull_request` with `opened`, `synchronize`, `reopened`, or `stacked` | `poll-on-stacked-pull-requests` is on and the pull request is in a stack | Poll |
| `pull_request` with `opened`, `synchronize`, or `reopened` | Auto-merge is enabled | Poll |
| `pull_request` with `opened`, `synchronize`, or `reopened` | Auto-merge is off and an active Approve review from a reviewer with write access exists | Poll |
| `pull_request` with `opened`, `synchronize`, or `reopened` | Neither | Skip |
| `pull_request` with any other activity type, including `stacked` when the row above does not apply | Always | Skip |
| `pull_request_review` with `submitted` and state `approved` | An active Approve review from a reviewer with write access exists | Poll |
| `pull_request_review` with `submitted` and state `approved` | No such review exists | Skip |
| `pull_request_review` otherwise | Always | Skip |

The rows are read from the top, and the first row that applies decides.

##### Pull requests in a stack

The `poll-on-stacked-pull-requests` input is a workaround for stacks, where enabling auto-merge was observed not to start the gate. It exists only until GitHub delivers that event.

A pull request is in a stack when the event's pull request carries a `stack` object.
GitHub sets it from the `stacked` activity type onward; an `opened` event never carries it, because a pull request joins a stack after it is created.

`poll-on-stacked-pull-requests` is `true` or `false`, and the default is `false`. Any other value fails the job before anything else happens.
When it is on, every pull request in a stack polls on `opened`, `synchronize`, `reopened`, and `stacked`, whether or not merge intent exists, and the reviews are not read for those events.
Review events are decided the same way as for a pull request outside a stack.
Pull requests outside a stack are not affected by the input.

The workflow has to list `stacked` among its `pull_request` activity types. Without it, a pull request that joins a stack and gets no further push is never evaluated.

To evaluate a pull request in a stack again, a maintainer pushes a commit or re-runs the gate job. Enabling auto-merge on the stack does not start the workflow.

##### Active Approve review

A reviewer has an active Approve review when that reviewer's latest review, not counting comment reviews, is an Approve.
A later dismissal or request for changes by the same reviewer ends it; a later comment review does not.

##### Write access

A reviewer has write access when the repository reports their permission as `admin` or `write`, or their role as `admin`, `maintain`, or `write`.
A user who is not a collaborator has no write access.
The reviewer's relationship to the repository shown on the review itself is not used, because a read-only collaborator has the same relationship as a maintainer.

##### Opting out of Approve as merge intent

A repository where an Approve review means "looks good" and not "ready to merge" removes `pull_request_review` from the workflow's triggers.
Pushes to a pull request that already has an active Approve review still count as merge intent.

#### Exceptional behavior

##### Skip

When the gate skips, the job succeeds, no commit status is written, and the step summary shows the state `skipped`. The `state` output is `skipped` and the count outputs are `0`.
The required check keeps whatever state the head commit already has. On a new head commit that is GitHub's "Expected — Waiting for status to be reported", which blocks merging.

### Verdict reporting in private mode

**Overview:** After polling, the gate writes the aggregated verdict as a commit status on the head commit.

**Input:** The aggregated verdict, the `context` input (default `automerge-gate/all-passed`), and the `token` input.

**Output:** A commit status with state `success` or `failure`. Its description is "N checks passed" or "N checks evaluated, at least one failed", where N is the number of evaluated checks. Its link opens the gate's workflow run, where the run can be re-run. On `failure` the gate job also fails.

#### Applicable conditions

##### Permissions

The job needs `statuses: write`, `checks: read`, `pull-requests: read`, and `actions: read`.

##### States written

Only `success` and `failure` are written. The gate never writes a `pending` status, before or during polling.

#### Exceptional behavior

##### The commit status cannot be written

When the write is refused, for example on a fork pull request whose token is read-only, the job fails and no commit status exists for the head commit.

##### The job ends before polling finishes

When the job is cancelled or reaches its `timeout-minutes` during polling, no commit status is written for the head commit.
To evaluate again, a maintainer re-runs the gate job, pushes a commit, or disables and re-enables auto-merge.

### Verdict reporting in public mode

**Overview:** The gate polls on every accepted event and ends the job with the aggregated verdict.

**Input:** The aggregated verdict.

**Output:** The job succeeds on `success` and fails on `failure`. GitHub creates a check run for the gate job, named after the job, and that check run is the required check. The gate writes nothing through the API.

#### Applicable conditions

##### Permissions

The job needs `checks: read`, `pull-requests: read`, and `actions: read`.

##### Job name

The job's `name:` must equal the required check in the ruleset. The `context` input is ignored.

##### No merge intent decision

Public mode does not look at auto-merge, reviews, or stacks. Every accepted event polls, including a `pull_request_review` event if the workflow listens to it. The `poll-on-stacked-pull-requests` input is ignored.

## Data requirements

### Required data

- **Pull request event:** The event name, activity type, pull request number, head commit, auto-merge state, review state, and the stack the pull request is in (its number, the pull request's position, and the stack's size). Read from the workflow's event; not stored.
- **Reviews:** Each reviewer's reviews on the pull request and each approving reviewer's permission on the repository. Read in private mode only, when the decision needs them; not stored.
- **Commit status:** The verdict written in private mode, kept by GitHub on the head commit.

### Relationships

A commit status belongs to one head commit and one context. A new head commit starts with no status for the context.

### Personal information

Reviewer login names and their permission levels are read and written to the job log in private mode. They are not sent anywhere else.

## External service dependencies

- **GitHub**
  - **Related user stories:** All.
  - **Reason for dependency:** Events, reviews, permissions, commit statuses, and the required check are all GitHub's.
  - **Contractual and usage decisions:** The gate runs on the repository's own runners and uses the workflow's token. Polling time counts toward the repository's GitHub Actions usage.

## Security considerations

An Approve review counts as merge intent only when the reviewer has write access, so a user who cannot merge cannot start the gate by approving.
Public mode needs no write permission, so a workflow started by a fork pull request cannot change the repository through the gate's token.
The token is used only to read checks, workflow runs, reviews, and permissions, and in private mode to write the commit status.

## Open questions

- **Unconfirmed: whether GitHub will deliver `auto_merge_enabled` for a stack.** The workaround assumes the event is not delivered, which was observed twice on 2026-11-17. GitHub's documentation does not say whether this is intended or temporary. When the event is delivered, the input can be deprecated; nobody is assigned to re-check. azu decides when to re-check.
