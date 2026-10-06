# Releasing (maintainers)

This document is the maintainer release procedure for automerge-gate. Releases are cut by two workflows: `create-release-pr` opens a release PR, and `release` publishes the GitHub Release when that PR is merged. There is no `npm publish` step.

## Pre-release checklist

1. `main` is green on CI.
2. `dist/index.js` is in sync with `src/`. The pre-commit hook keeps it in sync; if in doubt run:
   ```bash
   npm run build
   git diff --exit-code dist/   # should be empty
   ```

## Cutting a release

1. Go to **Actions → create-release-pr → Run workflow** and pick `patch`, `minor` or `major`.
2. The workflow computes the next version from the latest release, opens a draft PR `Release vX.Y.Z` from `release/vX.Y.Z` with the `Type: Release` label, and points the `uses: pkgdeps/automerge-gate@vX.Y.Z` examples in `README.md` and `docs/migration-from-merge-gatekeeper.md` at the new version. The PR body holds the generated release notes; edit them there if needed.
3. Mark the PR ready for review and approve it. A PR opened by `GITHUB_TOKEN` does not start `pull_request` workflows, so the approval is what runs `automerge-gate/self-test`.
4. Merge the PR. The `release` workflow creates the tag and the GitHub Release on the merge commit, using the PR body as the release notes, and marks it as the latest release.

The repository needs **Settings → Actions → General → Allow GitHub Actions to create and approve pull requests** turned on for step 2.

## After publishing

Users pin a fixed version: `uses: pkgdeps/automerge-gate@v3.0.0`. Renovate / Dependabot will open update PRs as new versions ship.

---

See the [README](../README.md) for usage.
