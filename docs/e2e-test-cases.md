# E2E test cases

The unit tests in `__tests__/` mock the GitHub API. The cases below are run against real GitHub in [pkgdeps/automerge-gate-example](https://github.com/pkgdeps/automerge-gate-example): each case is a PR (or a series of pushes to one PR) in that repository, and the result is the gate's verdict on the head SHA.

## How to run a case

1. Point the example repository's gate workflow at the version under test (`uses: pkgdeps/automerge-gate@<sha or tag>`).
2. Create the PR or push the commits the case describes.
3. For private mode, enable Auto Merge (or Approve) so the gate polls. Public mode polls on every event.
4. Read the gate job's log and the commit status (private) or job conclusion (public) on the head SHA.

To observe the gate without letting the PR merge, use a context that is not the required check (for example `probe/all-passed`) and remove the real gate workflow on the PR branch, as in [automerge-gate-example#44](https://github.com/pkgdeps/automerge-gate-example/pull/44).

## Merge intent and aggregation

These were last run against v4. PR links point to the run in the example repository.

| Case | Scenario | Expected | PR |
| --- | --- | --- | --- |
| TC2 | Enable Auto Merge, every check passes | success, PR merges | [#3](https://github.com/pkgdeps/automerge-gate-example/pull/3) |
| v4-TC3 | Enable Auto Merge with a failing check | failure, merge stays blocked | [#37](https://github.com/pkgdeps/automerge-gate-example/pull/37) |
| v4-TC4 | After v4-TC3, push a commit that fixes the check | new SHA is re-evaluated, success, PR merges | [#37](https://github.com/pkgdeps/automerge-gate-example/pull/37) |
| v4-TC5 | `ignore-checks` excludes every `github-actions` check | gate does not stall waiting on excluded checks | [#38](https://github.com/pkgdeps/automerge-gate-example/pull/38) |
| v4-TC6 | `ignore-checks` with `optional-*` and a failing `optional-task` | success, the failing optional check is ignored | [#39](https://github.com/pkgdeps/automerge-gate-example/pull/39) |
| v4-TC11b | `ignore-checks` excludes the `vercel` app | evaluated count drops by one | [#40](https://github.com/pkgdeps/automerge-gate-example/pull/40) |
| v4-TC9 | Fork PR in private mode | commit status write fails with 403 (read-only token) | [#41](https://github.com/pkgdeps/automerge-gate-example/pull/41) |
| pub-TC9 | Fork PR in public mode | works with the read-only token; the job exit code is the signal | [#34](https://github.com/pkgdeps/automerge-gate-example/pull/34) |
| v4-TC-v2b | Another user with write access Approves (no Auto Merge) | gate polls and writes the status | [#43](https://github.com/pkgdeps/automerge-gate-example/pull/43) |
| v4-TC-v2d | A non-Approve review (comment) is submitted | gate job is skipped, no status is written | [#42](https://github.com/pkgdeps/automerge-gate-example/pull/42) |

## Cancelled runs replaced by a newer run

Added for [#41](https://github.com/pkgdeps/automerge-gate/pull/41) / [#42](https://github.com/pkgdeps/automerge-gate/pull/42). TC-cancel-1 to 6 run in [automerge-gate-example#44](https://github.com/pkgdeps/automerge-gate-example/pull/44), TC-cancel-7 in [#45](https://github.com/pkgdeps/automerge-gate-example/pull/45), with a `cancel-probe` workflow: `slow` (`sleep 60`) and `after` (`needs: slow`), with `concurrency: cancel-in-progress: true` at the workflow level.

| Case | Steps | Expected | Last run |
| --- | --- | --- | --- |
| TC-cancel-1 | Push, then add a label while `slow` is running. The second `pull_request` run cancels the first on the same SHA. | success. The cancelled `slow` and `after` are ignored. (v5.0.1 fails here.) | [public, v5.0.1: failure](https://github.com/pkgdeps/automerge-gate-example/actions/runs/36079363469) / [public, fix: success](https://github.com/pkgdeps/automerge-gate-example/actions/runs/36079736390) |
| TC-cancel-2 | Push SHA A, force-push its parent, force-push A again. A has one cancelled run and one newer run. | success | [private: success](https://github.com/pkgdeps/automerge-gate-example/actions/runs/36081887467) |
| TC-cancel-3 | Push A, parent, A, parent, A. A has two cancelled runs and one newer run. | success | [private: success](https://github.com/pkgdeps/automerge-gate-example/actions/runs/36082077309) |
| TC-cancel-4 | Cancel the newest `pull_request` run by hand (no newer run exists). | failure. A cancellation with no newer run is kept. | [private: failure](https://github.com/pkgdeps/automerge-gate-example/actions/runs/36082264332) |
| TC-cancel-5 | The workflow also runs on `push`. Cancel the `push` run by hand while the newer `pull_request` run passes. | failure. `push` and `pull_request` runs never replace each other. | [private: failure](https://github.com/pkgdeps/automerge-gate-example/actions/runs/36082394929) |
| TC-cancel-6 | Private mode with Auto Merge enabled, then TC-cancel-1. | success, `probe/all-passed` is written as success | [private: success](https://github.com/pkgdeps/automerge-gate-example/actions/runs/36081500216) |
| TC-cancel-7 | TC-cancel-2 timed so the gate polls while the newer `cancel-probe` run is queued and has no jobs yet. | The gate keeps polling until that run's jobs appear and finish. v5.0.2 reported success on the first poll. | [v5.0.2, private: success too early](https://github.com/pkgdeps/automerge-gate-example/actions/runs/36083244779) / [fix, private: waits, then success](https://github.com/pkgdeps/automerge-gate-example/actions/runs/36083779635) |

## Failed jobs in a run replaced by a newer run

TC-label-1 and 2 run in [automerge-gate-example#46](https://github.com/pkgdeps/automerge-gate-example/pull/46) with a `label-probe` workflow (`pull_request` with `labeled` / `unlabeled`): job `breaking` fails unless the PR has the `probe-ok` label, and is skipped via `if:` when it has `probe-skip`. The gate does not evaluate on `labeled`, so each case enables Auto Merge after the label is added.

| Case | Steps | Expected | Last run |
| --- | --- | --- | --- |
| TC-label-1 | Push without labels; `breaking` fails and its run completes. Add `probe-ok`; the `labeled` run on the same SHA passes `breaking`. Enable Auto Merge. | success. The older `breaking` failure is ignored because the newer run ran the same job. (v5.0.3 fails here.) | [private, v5.0.3: failure](https://github.com/pkgdeps/automerge-gate-example/actions/runs/36128187311) / [private, fix: success](https://github.com/pkgdeps/automerge-gate-example/actions/runs/36128304400) |
| TC-label-2 | Push without labels; `breaking` fails. Add `probe-skip`; the newer run skips `breaking`. Enable Auto Merge. | failure. A `skipped` job in the newer run does not clear the older failure. | [private, fix: failure](https://github.com/pkgdeps/automerge-gate-example/actions/runs/36128441148) |
