# CI / deploy setup

One-time repository configuration the workflows in this directory depend on.
Most of these can only be done by a repo admin in the GitHub UI — they cannot be
committed to the repo.

## 1. GitHub Pages (API docs deploy) — required for `docs.yml`

The `API docs` workflow publishes the typedoc site to GitHub Pages. It fails
until Pages is switched to the Actions source:

**Settings → Pages → Build and deployment → Source → "GitHub Actions".**

After that, pushing to `main` deploys to
`https://alirezahematidev.github.io/zerowatch/`. No secret or token is needed —
Pages uses the workflow's built-in `GITHUB_TOKEN` with the `pages: write` /
`id-token: write` permissions already declared in `docs.yml`.

## 2. Claude GitHub App + `ANTHROPIC_API_KEY` — required for `claude.yml` and `claude-code-review.yml`

These workflows call `anthropics/claude-code-action`, which needs two things:

1. **Install the Claude GitHub App** on this repository. The easiest path is to
   run `/install-github-app` from Claude Code, or install it from
   <https://github.com/apps/claude>. This grants the App permission to read
   issues/PRs and post comments.

2. **Add the API key secret.** Create an API key at
   <https://console.anthropic.com/settings/keys>, then add it as a repository
   secret:

   **Settings → Secrets and variables → Actions → New repository secret**
   - Name: `ANTHROPIC_API_KEY`
   - Value: your `sk-ant-…` key

   Both workflows reference `${{ secrets.ANTHROPIC_API_KEY }}`. Without the
   secret the jobs fail immediately with an authentication error.

   > Prefer a Claude subscription (OAuth) over an API key? Swap
   > `anthropic_api_key:` for `claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}`
   > in both workflow files and add that secret instead. `/install-github-app`
   > can generate the OAuth token for you.

## 3. Nothing extra for `ci.yml`

Test/typecheck/build/attw run entirely on the built-in `GITHUB_TOKEN` with
read-only permissions. No secrets required.

## Quick checklist

- [ ] Pages source set to "GitHub Actions"
- [ ] Claude GitHub App installed on the repo
- [ ] `ANTHROPIC_API_KEY` (or `CLAUDE_CODE_OAUTH_TOKEN`) secret added
