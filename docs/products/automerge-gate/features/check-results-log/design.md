# Check results log design

[日本語](design.ja.md)

## About this document

This document describes how the gate produces the output defined in [Check results log](requirements.md), and why the log is shaped as one group per poll with a flat final list.
The parent Product is [automerge-gate](../../product.md).

### Audience

People and agents who change what the gate prints.

### Prerequisites

GitHub Actions log groups and the step summary. Log groups cannot be nested.

### Outside this document

The polling loop and the reading of a check belong to [Check aggregation](../check-aggregation/requirements.md).

## Implementation approach

Formatting is separated from output.
One module of pure functions turns a list of evaluated checks into strings: the poll title, the poll body lines, and the final result as log lines plus summary Markdown.
The two runners call those functions and do the writing, so the same text appears in private and public mode and the formatting is tested without a job log.

### Getting the checks to the formatter

The polling loop reports each poll with its number, state, and counts, but not with the checks themselves.
Each runner's fetch function therefore remembers the evaluated checks of the latest poll in a variable the runner can read.
The loop calls the fetch function first and the per-poll callback second, so when the callback formats the group the remembered list is the one that poll evaluated.
After the loop, the same variable holds the last poll's checks for the final result and the step summary.

Extending the loop's callback to carry the checks was the other option.
Remembering them in the runner was chosen because it leaves the loop's interface unchanged.

The callback writes the group through the toolkit's group helper, which closes the group even when the body throws, and the loop awaits the callback so that groups cannot interleave.

### Why one group per poll

The log has three jobs: show that the gate is alive while someone watches, leave evidence of what was pending when a job times out, and state the final verdict per check.
A group per poll serves the first two.
While a group is open its lines stream into view, and when it closes it collapses to its title, so a watcher sees a new titled line at every interval and the finished log is one line per poll.
The elapsed time in the title is there to make the passing of time visible.

Because groups cannot be nested, no group wraps the whole polling phase or the result.
The private-mode "Setup" group is compatible with this, because it holds fixed start-up information and ends before polling begins.

The last poll's group repeats what the final result shows.
It is kept as the record of that poll, and the final result is written outside any group so that it is visible without expanding anything.

### Final result and step summary

The final result separates the checks by reading, sorts each part by name, and puts failures first because they are what the reader is looking for.
The same split produces the Markdown for the step summary, which is appended after the table of counts.
A blank line is written between the table and the Markdown; without it GitHub renders the heading that follows the table as raw text.

Pending checks are counted and reported as a warning by the runner.
They cannot occur after a loop that only ends without pending checks, so the count is a guard against a future change to the loop.

The summary is written by a helper in the private runner and inline in the public runner.
Both write the same rows, and the `gate-mode` row is the only one whose value depends on the mode.

## Architecture and sequence diagrams

A diagram is unnecessary. The flow is: the loop finishes a poll, the runner formats the remembered checks into a group; after the loop the runner formats the last checks into the final result and the summary.

## Data model and ER diagrams

No data of its own. The formatter's result has three parts: log lines, summary Markdown (empty when there is nothing to list), and the number of pending checks.

## APIs and interfaces

### Job log

- Poll group: title `[mm:ss] Poll #N — STATE, COMPLETED/TOTAL completed`; body lines `  <icon> <name> (<label>)`.
- Final result: `❌ Failed (N):` and `✅ Passed (M):` with lines `  - <name> (<label>)`.

### Step summary

The heading, the table, and the "Check results" Markdown described in the Requirements.

## External service integration

None. Output goes through the GitHub Actions toolkit to the job log and the step summary file.

## Data handling

Check names, statuses, and conclusions are copied into the log and summary as read. Nothing else is stored.

## Authentication and authorization notes

None. Writing the job log and step summary needs no permission.

## Security considerations

None beyond the Requirements. Check names in the summary are wrapped in code formatting, so Markdown in a name is not rendered.

## Deployment notes

None.

## Alternatives considered

### Showing only pending checks in each poll

A shorter body would list only what is still pending. The body lists every check with its state, sorted by name, so that two polls can be compared line by line. No record of a comparison with the shorter form remains.

### Keeping one group around all polls

Groups cannot be nested, so a group around all polls rules out one group per poll.

### Showing failure details in the log

Annotations and error messages are not copied. They are available on GitHub's page for each check.

## Open questions

None.
