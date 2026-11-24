#!/usr/bin/env bash
# Pull requests through GitHub's REST API only (`gh api`), so it works in Claude
# Code cloud sessions too, where GraphQL (gh pr checks / gh pr merge / gh pr
# create) is blocked.
#
#   scripts/pr.sh create <branch> "<title>" <body-file>   → prints the PR number
#   scripts/pr.sh merge-after-ci <number> [--dry-run]      → waits for CI; merges only if it passed
#
# merge-after-ci: waits until every check on the PR's latest commit has finished
# (up to 40 minutes), then merges when all passed (or were skipped). A PR that
# changes only docs (*.md, docs/**) gets no CI run and is merged directly.
set -euo pipefail

repo="${PRODLI_REPO:-$(git remote get-url origin 2>/dev/null | sed -E 's#(git@github.com:|https://github.com/)##; s#\.git$##')}"
repo="${repo:-sysuin/prodli}"
cmd="${1:-}"

case "$cmd" in
  create)
    branch="${2:?branch}"; title="${3:?title}"; body_file="${4:?body file}"
    gh api "repos/$repo/pulls" -f base=main -f head="$branch" -f title="$title" -F body=@"$body_file" -q .number
    ;;

  merge-after-ci)
    pr="${2:?PR number}"; dry="${3:-}"
    state="$(gh api "repos/$repo/pulls/$pr" -q .state)"
    [ "$state" = open ] || { echo "PR #$pr is $state, not open."; exit 1; }
    sha="$(gh api "repos/$repo/pulls/$pr" -q .head.sha)"
    docs_only="$(gh api "repos/$repo/pulls/$pr/files" --paginate -q '.[].filename' | grep -vE '(\.md$|^docs/)' >/dev/null && echo no || echo yes)"
    echo "PR #$pr at ${sha:0:7} (docs only: $docs_only). Waiting for CI…"
    deadline=$(( $(date +%s) + 40 * 60 )); seen_at=""
    while :; do
      runs="$(gh api "repos/$repo/commits/$sha/check-runs?per_page=100" -q '.check_runs[] | "\(.status) \(.conclusion // "-") \(.name)"')"
      total="$(printf '%s\n' "$runs" | grep -c . || true)"
      if [ "$total" = 0 ]; then
        seen_at="${seen_at:-$(date +%s)}"
        if [ $(( $(date +%s) - seen_at )) -ge 120 ]; then
          if [ "$docs_only" = yes ]; then echo "No CI for a docs-only PR."; break; fi
          echo "CI didn't start within 2 minutes - NOT MERGED"; exit 1
        fi
      else
        pending="$(printf '%s\n' "$runs" | grep -vc '^completed ' || true)"
        failed="$(printf '%s\n' "$runs" | grep '^completed ' | grep -vE '^completed (success|skipped|neutral) ' || true)"
        if [ -n "$failed" ]; then printf '%s\n' "$failed"; echo "CI FAILED - NOT MERGED"; exit 1; fi
        if [ "$pending" = 0 ]; then echo "CI passed ($total checks)."; break; fi
      fi
      [ "$(date +%s)" -lt "$deadline" ] || { echo "CI still running after 40 minutes - NOT MERGED"; exit 1; }
      sleep 20
    done
    # The PR may have moved on while we waited: only merge the commit CI checked.
    [ "$(gh api "repos/$repo/pulls/$pr" -q .head.sha)" = "$sha" ] || { echo "New commits arrived while waiting - NOT MERGED (run again)"; exit 1; }
    if [ "$dry" = --dry-run ]; then echo "Dry run: would merge #$pr now."; exit 0; fi
    gh api -X PUT "repos/$repo/pulls/$pr/merge" -f merge_method=merge -f sha="$sha" -q .message
    echo MERGED
    ;;

  *)
    sed -n '2,12p' "$0"; exit 1 ;;
esac
