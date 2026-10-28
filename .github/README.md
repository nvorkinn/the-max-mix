# Pull request workflows

`create_global_pr_status.yml` opens a **Global PR Status** check on the head commit of every pull request from a branch in
this repository, Dependabot's included, and `all-checks.yml` completes it, and approves the PR, once every other workflow
and check on that commit has passed. `all-checks.yml` is a thin caller of the reusable workflow in
[nvorkinn/.github](https://github.com/nvorkinn/.github/tree/main/.github/workflows), pinned to a commit.

The status workflow runs on `pull_request_target`, the one event that gives Dependabot pull requests a token that can create
a check. That event runs the workflow from the default branch and the workflow never checks out the pull request's code, so
it is safe; forks are skipped. Dependabot pull requests are not auto-approved, so they still need a manual merge.

`tests.yml` runs lint, tests and the production build on every pull request and push to `main`; it is listed in
`all-checks.yml`, so Global PR Status waits for it.

`audit.yml` scans the lockfiles weekly with `npm audit`. It does not run on pull requests, so it is deliberately not in
`all-checks.yml`.

`dependabot.yml` opens daily grouped update PRs for the three npm projects and the GitHub Actions used here.

- **Required check:** `Global PR Status`.
- **Repository setting:** Settings > Actions > General > Workflow permissions >
  **Allow GitHub Actions to create and approve pull requests** must stay enabled.
- `CodeQL` (code scanning, configured as GitHub's default setup under Settings > Code security) is listed in
  `all-checks.yml` too, so Global PR Status is also re-evaluated when CodeQL finishes, which is usually the last check.
- When you add a workflow that runs on pull requests, add its `name` to `workflows:` in `all-checks.yml`.
