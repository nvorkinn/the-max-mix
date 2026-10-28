# Pull request workflows

`all-checks.yml` and `create_global_pr_status.yml` are thin callers of the reusable workflows in
[nvorkinn/.github](https://github.com/nvorkinn/.github/tree/main/.github/workflows), pinned to a commit and kept in line
with the other repositories (for example [countdown](https://github.com/nvorkinn/countdown/tree/main/.github/workflows)).
`create_global_pr_status.yml` opens a **Global PR Status** check on each PR's head commit, Dependabot's included (its
`permissions: checks: write` raises Dependabot's read-only token), and `all-checks.yml` completes it, and approves the PR,
once every other workflow and check on that commit has passed. Dependabot pull requests are not auto-approved, so they
still need a manual merge. Fork pull requests get no check.

`tests.yml` runs lint, tests and the production build on every pull request and push to `main`; it is listed in
`all-checks.yml`, so Global PR Status waits for it.

`lint.yml` (**Lint**) is a placeholder for now: it only echoes a message. It is listed in `all-checks.yml` so the real
linting can be added later and gate Global PR Status.

`audit.yml` scans the lockfiles weekly with `npm audit`. It does not run on pull requests, so it is deliberately not in
`all-checks.yml`.

`dependabot.yml` opens daily grouped update PRs for the three npm projects and the GitHub Actions used here.

- **Required check:** `Global PR Status`.
- **Repository setting:** Settings > Actions > General > Workflow permissions >
  **Allow GitHub Actions to create and approve pull requests** must stay enabled.
- `CodeQL` (code scanning, configured as GitHub's default setup under Settings > Code security) is listed in
  `all-checks.yml` too, so Global PR Status is also re-evaluated when CodeQL finishes, which is usually the last check.
- When you add a workflow that runs on pull requests, add its `name` to `workflows:` in `all-checks.yml`.
