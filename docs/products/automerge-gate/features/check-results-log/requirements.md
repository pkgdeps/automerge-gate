# Check results log

[日本語](requirements.ja.md)

## About this document

The check results log shows, by name, the state of each evaluated check while the gate polls and after it ends, in the job log and in the step summary.
A maintainer can see which check is still running or which one failed without opening each check separately.
The parent Product is [automerge-gate](../../product.md).

### Scope

- The log entry written for each poll.
- The final list of failed and passed checks in the job log.
- The step summary.

### Out of scope

- Which checks are evaluated and how each is read as passing, failing, or pending. See [Check aggregation](../check-aggregation/requirements.md).
- Details of a failure, such as annotations or error messages. They are reached through GitHub's own page for the check.
- Per-check output on a skip in private mode. No checks are read on a skip. See [Gate modes](../gate-modes/requirements.md).

## User stories

### See what the gate is waiting for

As a maintainer watching the gate job, I want each poll to list every check with its state so that I can see the gate is alive and what it waits for, also after a timeout.

**Acceptance criteria:**

Scenario: When a poll finishes, the log gets a collapsible group listing every evaluated check

- Given: The gate is polling five seconds after it started, and of three evaluated checks `build` has failed, `lint` has succeeded, and `test` is in progress.
- When: The first poll finishes.
- Then: The job log has a group titled `[00:05] Poll #1 — pending, 2/3 completed` that contains the lines `❌ build (failure)`, `✅ lint (success)`, and `🟡 test (in_progress)` in that order.

Scenario: When the job times out during polling, the earlier polls remain in the log

- Given: The gate has polled three times, and one check is still queued.
- When: The job reaches its timeout.
- Then: The job log contains the three poll groups, and the last one shows the queued check by name.

Scenario: When a result of a replaced run is ignored, the log says so once

- Given: A cancelled check run named `slow` belongs to a workflow run that a newer run replaced.
- When: The gate polls several times.
- Then: The job log contains one line `ignoring slow (cancelled): a newer run of the same workflow replaced it`, not one per poll.

### See the result in one place

As a maintainer whose pull request is blocked, I want the failed checks listed by name at the end so that I do not have to search the pull request's checks for the cause.

**Acceptance criteria:**

Scenario: When polling ends with failed checks, the log lists failed checks before passed ones

- Given: Polling ended with `build` failed, `lint` cancelled, and `test` and `codeql` passed.
- When: The gate writes the final result.
- Then: The job log shows, outside any group, `❌ Failed (2):` followed by `- build (failure)` and `- lint (cancelled)`, then `✅ Passed (2):` followed by `- codeql (success)` and `- test (success)`.

Scenario: When no check failed, the Failed section is omitted

- Given: Polling ended with every evaluated check passed.
- When: The gate writes the final result.
- Then: The job log shows only the `✅ Passed (N):` section.

Scenario: When no check was evaluated, no list is written

- Given: Polling ended with zero evaluated checks.
- When: The gate writes the final result.
- Then: The job log has neither a Failed nor a Passed section, and the step summary has no "Check results" section.

Scenario: When polling ends, the step summary shows the counts and every check

- Given: Polling ended with one failed and three passed checks.
- When: The gate writes the step summary.
- Then: The step summary has a heading with the state, a table of counts, and a "Check results" section that lists the failed check under `❌ Failed (1)` and the passed checks under `✅ Passed (3)`.

Scenario: When the gate skips in private mode, the step summary shows the skip without checks

- Given: The gate runs in private mode on a push without merge intent.
- When: The gate skips.
- Then: The step summary has the heading `🟡 automerge-gate: skipped`, a table whose `gate-mode` row is `private` and whose counts are zero, and no "Check results" section.

## KPIs

None. No measurement of this feature is recorded.

## Functional requirements

### Poll group

**Overview:** After every poll that read the checks, the gate writes one collapsible group to the job log.

**Input:** The evaluated checks of that poll, the poll number, the state, and the time since polling started.

**Output:** A group whose title is `[mm:ss] Poll #N — STATE, COMPLETED/TOTAL completed` and whose body has one line per evaluated check.

#### Applicable conditions

##### Title

`mm:ss` is the time since polling started, in zero-padded minutes and seconds; minutes continue past 59.
`STATE` is `pending`, `success`, or `failure`.
`COMPLETED` and `TOTAL` count the evaluated checks.

##### Body

Each line is `<icon> <name> (<label>)`, indented by two spaces.
The icon is `✅` for a passing check, `❌` for a failing check, and `🟡` for a pending one.
The label is the check's conclusion when it has one, otherwise its status.
Lines are sorted by check name, so the order stays the same from poll to poll.

##### Which polls

Every poll gets a group, including the last one. A poll that failed to read from GitHub gets a warning line and no group.

### Final result

**Overview:** After polling ends and before the verdict is reported, the gate lists the evaluated checks of the last poll by reading.

**Input:** The evaluated checks of the last poll.

**Output:** Outside any group, a `❌ Failed (N):` section and then a `✅ Passed (M):` section, each with one line `  - <name> (<label>)` per check, sorted by name.

#### Applicable conditions

##### Empty sections

A section with no checks is omitted.

#### Exceptional behavior

##### A pending check at result time

A check that is still pending when the result is written is left out of both sections, and the gate logs the warning `pending check(s) at result time: N`.
Polling ends only when no check is pending, so this is not expected to happen.

### Step summary

**Overview:** The gate writes a summary of the run to the job's step summary.

**Input:** The state, the counts, the number of polls, and the evaluated checks of the last poll.

**Output:**

- A heading `<emoji> automerge-gate: <state>`, with `✅` for `success`, `❌` for `failure`, and `🟡` otherwise.
- A table with the rows: `gate-mode`, the state, total checks before exclusions, evaluated checks, completed checks, and polling iterations.
- A "Check results" section with `❌ Failed (N)` and `✅ Passed (M)` lists, each line `` `name` — label ``. Empty lists are omitted, and the section is omitted when both are empty.

#### Applicable conditions

##### Mode row

The `gate-mode` row shows `private` or `public`. Whether private mode polled or skipped is read from the state row.

### Other log lines

**Overview:** The gate writes a few fixed lines around polling.

**Output:**

- In private mode, a collapsible "Setup" group with the event, the pull request number and head commit, the review lookup, and the decision with its reason.
- One line for each result of a replaced run that is ignored, written the first time it is ignored.
- A warning for each poll that failed to read from GitHub.

## Data requirements

### Required data

- **Evaluated checks:** Name, status, and conclusion of each evaluated check on each poll. Shown in the job log and step summary, which GitHub keeps with the workflow run.

### Relationships

None beyond the checks belonging to one poll.

### Personal information

None in this feature's output. The reviewer names in the private-mode "Setup" group are described in [Gate modes](../gate-modes/requirements.md).

## External service dependencies

None. The output uses the job log and step summary of the workflow run the gate already runs in.

## Security considerations

Check names come from workflows and GitHub Apps and are shown as they are. Anyone who can read the repository's workflow runs can read them, the same as on the pull request's checks.

## Open questions

None.
