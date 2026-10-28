# Pull request workflows

`all-checks.yml` and `create_global_pr_status.yml` are thin callers of the reusable workflows in
[nvorkinn/.github](https://github.com/nvorkinn/.github/tree/main/.github/workflows), pinned to a commit.
`create_global_pr_status.yml` opens a **Global PR Status** check on each PR's head commit, and `all-checks.yml`
completes it, and approves the PR, once every other workflow and check on that commit has passed.

- **Required check:** `Global PR Status`.
- **Repository setting:** Settings > Actions > General > Workflow permissions >
  **Allow GitHub Actions to create and approve pull requests** must stay enabled.
- When you add a workflow that runs on pull requests, add its `name` to `workflows:` in `all-checks.yml`.
