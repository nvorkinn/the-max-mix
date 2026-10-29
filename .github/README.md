# Pull request workflows

`all-checks.yml` and `create_global_pr_status.yml` are thin callers of the reusable workflows in
[nvorkinn/.github](https://github.com/nvorkinn/.github/tree/main/.github/workflows), pinned to a commit and kept in line
with the other repositories (for example [countdown](https://github.com/nvorkinn/countdown/tree/main/.github/workflows)).
`create_global_pr_status.yml` opens a **Global PR Status** check on each PR's head commit, Dependabot's included (its
`permissions: checks: write` raises Dependabot's read-only token), and `all-checks.yml` completes it, and approves the PR,
once every other workflow and check on that commit has passed. Dependabot pull requests are not auto-approved (see
`dependabot-auto-merge.yml` below for what that means for merging them). Fork pull requests get no check.

`tests.yml` runs the tests and the production build on every pull request and push to `main`; it no longer lints. It is
listed in `all-checks.yml`, so Global PR Status waits for it.

`lint.yml` (**Lint**) runs on the same triggers with three jobs: ESLint (`npm run lint`), ShellCheck over `scripts/*.sh`
and actionlint over `.github/workflows/*.yml`. ShellCheck and actionlint are downloaded as pinned release binaries and
checked against a SHA-256 before running. It is listed in `all-checks.yml` too.

`release.yml` runs on a version tag (`v*`) or by hand with an existing tag: it builds the app, packs the Raspberry Pi
kiosk download into `public/kiosk/` and deploys to Vercel production with a pinned Vercel CLI. It is the only way
production is deployed (`vercel.json` turns off Vercel's deploy of `main`). It needs the repository secrets
`VERCEL_TOKEN`, `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` and fails clearly if one is missing. It has read-only
`contents` access and does not run on pull requests, so it is not in `all-checks.yml`.

`audit.yml` scans the lockfile weekly with `npm audit`. It does not run on pull requests, so it is deliberately not in
`all-checks.yml`.

`dependabot-auto-merge.yml` turns on auto-merge for Dependabot pull requests whose updates are all patch or minor
(grouped ones included); majors are left for a manual review. Auto-merge only completes once branch protection is
satisfied, and Dependabot pull requests are not auto-approved, so if the `main` rule requires an approving review these
still wait for one manual approval; the workflow does not approve them itself.

`dependabot.yml` opens daily grouped update PRs for the npm project and the GitHub Actions used here.

- **Required check:** `Global PR Status`.
- **Repository setting:** Settings > Actions > General > Workflow permissions >
  **Allow GitHub Actions to create and approve pull requests** must stay enabled.
- `CodeQL` (code scanning, an advanced setup defined in `codeql.yml`) is listed in
  `all-checks.yml` too, so Global PR Status is also re-evaluated when CodeQL finishes, which is usually the last check.
- When you add a workflow that runs on pull requests, add its `name` to `workflows:` in `all-checks.yml`.
