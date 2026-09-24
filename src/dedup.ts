import { matchesAnyRule, type AggregatedCheckRun } from './filter.js'
import type { CheckRule } from './inputs.js'

// Drops cancelled check_runs that a newer run of the same check has
// superseded, for runs matching the `dedup-checks` rules. Workflows using
// `concurrency: cancel-in-progress: true` can leave a cancelled check_run
// on the head SHA next to a fresh same-named run in a different
// check_suite (e.g. two `synchronize` events delivered for one push, a
// `labeled` event, or a re-delivered webhook). The Checks API's
// `filter=latest` default only collapses duplicates within one suite;
// this module covers the cross-suite case, which would otherwise turn the
// aggregate red on a superseded cancellation.
//
// Only `cancelled` runs are ever dropped. A superseded run that failed,
// timed out, or needs action stays in the aggregate, because a newer run
// of the same job does not prove the older failure away — the newer run
// may have been started by a different activity type and skipped the job
// via `if:` (a `skipped` conclusion counts as green).
//
// Pure function — no I/O. Logging of dropped runs happens in the gates.

export type DedupDrop = {
  run: AggregatedCheckRun
  supersededBy: AggregatedCheckRun
}

export type DedupResult = {
  // Input order preserved.
  kept: AggregatedCheckRun[]
  dropped: DedupDrop[]
}

// Runs are grouped per (app, workflow file, check name). The workflow
// path is part of the key because the same job name can legitimately
// exist in several workflows on one SHA (the monorepo pattern documented
// in README "Discovering what to ignore") — grouping by name alone would
// let one workflow's run supersede another workflow's cancellation.
// JSON.stringify of a tuple is collision-free regardless of what
// characters appear in slugs, paths, or names.
const groupKey = (run: AggregatedCheckRun): string =>
  JSON.stringify([run.app.slug, run.workflow_path ?? null, run.name])

// A run only enters the dedup pool when a rule matches it AND its group
// key is trustworthy. For github-actions runs that requires a resolved
// `workflow_path` (a string) — with the path unresolved (undefined) or
// unresolvable (null, e.g. token lacks `actions: read`), grouping would
// degrade to (app, name) and risk the cross-workflow collapse described
// above. Mirroring ruleMatches' conservative-by-default stance, such
// runs pass through untouched. Third-party Checks have no workflow file,
// so their `null` path is genuinely N/A and (app, name) grouping is
// correct for them.
const isPoolEligible = (
  run: AggregatedCheckRun,
  rules: CheckRule[]
): boolean => {
  if (!matchesAnyRule(rules, run)) return false
  if (run.app.slug === 'github-actions') {
    return typeof run.workflow_path === 'string'
  }
  return true
}

// Finds the newest run per group by check_run id. GitHub's own
// required-check evaluation resolves duplicate-named check_runs the same
// way (see docs/lessons/2026-05-06-check-run-pending-state-mapping.md
// §2–§3): ids are assigned monotonically at creation, and re-runs create
// new rows with higher ids, so max-id is "most recently created" even
// when an older suite is re-run after a newer one started. A cancelled
// run is dropped only when that newest run is a different, newer run;
// the newest run itself is always kept, whatever its verdict.
export const dropSupersededCancellations = (
  runs: AggregatedCheckRun[],
  rules: CheckRule[]
): DedupResult => {
  if (rules.length === 0) return { kept: runs, dropped: [] }

  const newest = new Map<string, AggregatedCheckRun>()
  for (const run of runs) {
    if (!isPoolEligible(run, rules)) continue
    const key = groupKey(run)
    const current = newest.get(key)
    if (current === undefined || run.id > current.id) {
      newest.set(key, run)
    }
  }

  const kept: AggregatedCheckRun[] = []
  const dropped: DedupDrop[] = []
  for (const run of runs) {
    if (run.conclusion !== 'cancelled' || !isPoolEligible(run, rules)) {
      kept.push(run)
      continue
    }
    const latest = newest.get(groupKey(run))
    if (latest === undefined || latest === run) {
      kept.push(run)
    } else {
      dropped.push({ run, supersededBy: latest })
    }
  }
  return { kept, dropped }
}
