#!/usr/bin/env bash
# Attach a JUnit report to the Jira issue named by the branch (NES-123-style key).
# Usage: attach-junit-to-jira.sh <branch> <report.xml> <label>
# Skips quietly (exit 0) when there is no key in the branch, no report, or no Jira secrets
# (pull requests from forks never receive secrets). Secrets come from the environment only.
set -euo pipefail

branch="${1:-}"
report="${2:-}"
label="${3:-report}"

key="$(printf '%s' "$branch" | grep -oE '^NES-[0-9]+' || true)"
if [ -z "$key" ]; then echo "No Jira key in branch name; skipping."; exit 0; fi
if [ ! -f "$report" ]; then echo "No report at $report; skipping."; exit 0; fi
if [ -z "${JIRA_BASE_URL:-}" ] || [ -z "${JIRA_USER_EMAIL:-}" ] || [ -z "${JIRA_API_TOKEN:-}" ]; then
  echo "Jira secrets not available; skipping."; exit 0
fi

# One file per run and commit, so the history of reports stays on the issue.
name="${label}-run${GITHUB_RUN_NUMBER:-0}-${GITHUB_SHA:0:7}.xml"
cp "$report" "$name"
status="$(curl -sS -o /dev/null -w '%{http_code}' -X POST \
  -u "${JIRA_USER_EMAIL}:${JIRA_API_TOKEN}" \
  -H 'X-Atlassian-Token: no-check' \
  -F "file=@${name}" \
  "${JIRA_BASE_URL%/}/rest/api/3/issue/${key}/attachments")"
rm -f "$name"
echo "Jira attachment for ${key}: HTTP ${status}"
# A failed upload must not fail the build.
exit 0
