# Pull request workflows

`all-checks.yml` and `create_global_pr_status.yml` are thin callers of the reusable workflows in
[nvorkinn/.github](https://github.com/nvorkinn/.github/tree/main/.github/workflows), pinned to a commit.
`create_global_pr_status.yml` opens a **Global PR Status** check on each PR's head commit, and `all-checks.yml`
completes it, and approves the PR, once every other workflow and check on that commit has passed.

`tests.yml` runs lint, tests and the production build on every pull request and push to `main`; it is listed in
`all-checks.yml`, so Global PR Status waits for it.

`audit.yml` scans the lockfiles weekly with `npm audit`. It does not run on pull requests, so it is deliberately not in
`all-checks.yml`.

`dependabot.yml` opens daily grouped update PRs for the three npm projects and the GitHub Actions used here.

- **Required check:** `Global PR Status`.
- **Repository setting:** Settings > Actions > General > Workflow permissions >
  **Allow GitHub Actions to create and approve pull requests** must stay enabled.
- `create_global_pr_status_dependabot.yml` opens the same check for Dependabot pull requests, which the shared workflow skips
  (they get a read-only token on `pull_request`). It uses `pull_request_target`, only runs for `dependabot[bot]`, and never
  checks out the pull request's code. Dependabot pull requests are not auto-approved, so they still need a manual merge.
- `CodeQL` (code scanning, configured as GitHub's default setup under Settings > Code security) is listed in
  `all-checks.yml` too, so Global PR Status is also re-evaluated when CodeQL finishes, which is usually the last check.
- When you add a workflow that runs on pull requests, add its `name` to `workflows:` in `all-checks.yml`.
