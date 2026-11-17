# automerge-gate

[日本語](product.ja.md)

## Overview

automerge-gate is a GitHub Action that turns every check on a pull request into one required check.
A repository registers only that single check in its ruleset or branch protection.
The action waits for the other checks on the pull request's head commit, across workflow files and GitHub Apps, and reports one aggregated verdict.
GitHub's native auto-merge merges the pull request once that required check is green; automerge-gate never merges by itself.

## Background and problems

### Background

GitHub's rulesets and branch protection ask a repository to list each required status check by name, and they combine the listed checks with AND only.
Auto-merge then waits for exactly the checks on that list ([Automatically merging a pull request](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/incorporating-changes-from-a-pull-request/automatically-merging-a-pull-request)).

One way to avoid that list is merge-gatekeeper, an action that polls the checks of a pull request and reports one result.
automerge-gate was made because merge-gatekeeper was no longer maintained and failed from time to time, and because it polls every pull request on every push, which holds a runner for around ten minutes each time even when nobody intends to merge.

The first version of this project, check-suite-gate, tried to aggregate checks without polling by reacting to `check_suite.completed`.
GitHub Actions does not start workflows for check suites that GitHub Actions itself created, so that design never ran in repositories that use only GitHub Actions.
automerge-gate replaced it with a polling action started by pull request events, which have no such restriction.

### Problems to solve

A maintainer who lists required checks by name has to keep the list in step with the checks that actually run, and the list breaks in three ways.

- Renovate and Dependabot bring in checks from external GitHub Apps that come and go.
- Monorepos use path filters, so a workflow runs on some pull requests and is absent on others.
- Adding a workflow file means rewriting the ruleset.

A maintainer who already aggregates checks with merge-gatekeeper has two further problems.

- The gate itself fails from time to time and is not being fixed, so a pull request whose checks pass can stay blocked.
- Every push to every pull request holds a runner until its checks finish, whether or not anyone intends to merge.

An aggregation job inside one workflow, such as alls-green, does not solve this either, because it cannot see jobs in other workflow files.

## Target users

### Maintainers of internal repositories

- **Characteristics:** They maintain a repository that does not receive pull requests from forks, often a monorepo with many workflow files and many pull requests from Renovate or Dependabot. Runner minutes are a cost they watch.
- **Problems:** The list of required checks does not stay correct, and polling every pull request wastes runner minutes on pull requests nobody is ready to merge.
- **Usage context:** They use private mode. They enable auto-merge or approve a pull request, and expect it to merge when every check passes.

### Maintainers of repositories that accept fork pull requests

- **Characteristics:** They maintain an open source repository. Workflows started by fork pull requests receive a read-only token.
- **Problems:** A gate that writes its result through the API cannot work on fork pull requests.
- **Usage context:** They use public mode, where the gate job's own result is the required check.

## Value provided

### One required check instead of a list

- **Recipient:** Maintainers of both kinds of repository.
- **Offering:** The ruleset names one check. Every check that lands on a pull request is aggregated into it, including checks from workflows and Apps added later.
- **Reason:** The list of required checks is the part that breaks; a single aggregated check needs no upkeep when checks are added or removed.

### Runner cost that follows merge intent

- **Recipient:** Maintainers of internal repositories.
- **Offering:** In private mode the gate polls only pull requests with merge intent, and skips the others in a few seconds.
- **Reason:** A polling gate holds a runner while it waits. Limiting polling to pull requests someone intends to merge makes the cost scale with merges, not with pushes.

### A gate that works with a read-only token

- **Recipient:** Maintainers of repositories that accept fork pull requests.
- **Offering:** In public mode the gate needs only read permissions.
- **Reason:** GitHub gives fork pull requests a read-only token, so the verdict has to travel without an API write.

## Key concepts

- **Required check:** The single check name registered in the ruleset or branch protection. The default name is `automerge-gate/all-passed`.
- **Gate mode:** The way the gate decides when to evaluate and how it reports the verdict. It is `private` or `public`, chosen with the `gate-mode` input.
- **Private mode:** The gate mode for repositories without fork pull requests. The gate evaluates only when merge intent exists and reports the verdict as a commit status.
- **Public mode:** The gate mode for repositories that accept fork pull requests. The gate evaluates on every triggering event and reports the verdict as the result of the gate job.
- **Merge intent:** The signal, in private mode, that someone wants the pull request merged: auto-merge is enabled, or a reviewer with write access has an active Approve review.
- **Stack:** A group of pull requests that GitHub links in order, each based on the one below it. In private mode a pull request in a stack can poll without merge intent.
- **Context:** The name of the commit status that private mode writes. It must equal the required check.
- **Check run:** One result reported on a commit through GitHub's Checks API, for example one job of a GitHub Actions workflow or one check from a GitHub App.
- **Aggregated verdict:** The single result, `success` or `failure`, that the gate derives from the check runs on the head commit.
- **Polling:** Re-reading the check runs at a fixed interval until the aggregated verdict is decided.
- **`ignore-checks` rule:** A rule that excludes matching check runs from the aggregated verdict.
- **Replaced run:** A workflow run on the head commit for which a newer run of the same workflow file and the same event exists.

## Feature list

| Feature | Description | Specification |
| --- | --- | --- |
| Gate modes | Decides when the gate evaluates a pull request and how the verdict reaches the required check | [Requirements](features/gate-modes/requirements.md) |
| Check aggregation | Collects the check runs on the head commit and polls until they give one verdict | [Requirements](features/check-aggregation/requirements.md) |
| Check results log | Shows the state of each check in the job log and the step summary | [Requirements](features/check-results-log/requirements.md) |
| `ignore-checks` | Excludes check runs that match rules on app, workflow, and name | Not written |
| Cancelled runs replaced by a newer run | Ignores results of a workflow run that a newer run of the same workflow replaced | Not written |

## Definition of success

A repository registers one required check and does not edit its ruleset when workflows or Apps are added or removed.
A pull request with merge intent merges without further action once every check passes, and stays blocked while any check fails.
In private mode, pull requests without merge intent do not hold a runner.

## Development principles

- **GitHub merges.** The action reports a verdict and leaves merging to GitHub's native auto-merge. It never calls the merge API.
- **One path for the verdict.** Each gate mode has exactly one way for the verdict to reach the required check, so there is no second signal to race with.
- **One timeout.** The job's `timeout-minutes` is the only bound on polling. The action has no timeout input, because two timeouts would have to be kept in step.
- **GitHub's own reading of results.** Which conclusions count as passing follows GitHub's rules for required status checks ([About status checks](https://docs.github.com/en/articles/about-status-checks)); the action does not define its own.
- **Runs inside GitHub Actions.** The action needs no external server and no GitHub App.
- **The workflow file is the switch.** Behavior that depends on which events start the gate is chosen in the user's workflow file, not through extra inputs.
- **Immutable releases.** Releases are immutable semver tags with no moving major tag, so a pinned version cannot be rewritten.

## SLA, SLI, and SLO

### SLA

None. automerge-gate is an action that runs inside the user's own workflow on the user's runners; there is no hosted service to guarantee.

### SLI and SLO

None. The project does not collect measurements from the repositories that use the action.

## Open questions

None.
