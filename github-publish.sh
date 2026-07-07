#!/usr/bin/env bash
set -euo pipefail

OWNER="${OWNER:-samisivonen-ux}"
REPO="${REPO:-rimaflow}"
VISIBILITY="${VISIBILITY:-public}" # public or private
BRANCH="${BRANCH:-main}"

if ! command -v git >/dev/null 2>&1; then
  echo "ERROR: git command not found."
  exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "ERROR: GitHub CLI 'gh' command not found. Install with: brew install gh"
  exit 1
fi

echo "Target GitHub repo: ${OWNER}/${REPO}"
echo "Visibility:          ${VISIBILITY}"
echo "Branch:              ${BRANCH}"

if ! gh auth status >/dev/null 2>&1; then
  echo "GitHub CLI is not logged in. Starting login..."
  gh auth login
fi

if [ ! -d .git ]; then
  git init
fi

git branch -M "${BRANCH}"

git add .
if git diff --cached --quiet; then
  echo "No local changes to commit."
else
  git commit -m "Initial RimaFlow app, AWS deploy and cutting plan"
fi

if gh repo view "${OWNER}/${REPO}" >/dev/null 2>&1; then
  echo "Repository already exists: ${OWNER}/${REPO}"
else
  echo "Creating repository: ${OWNER}/${REPO}"
  if [ "${VISIBILITY}" = "private" ]; then
    gh repo create "${OWNER}/${REPO}" --private --source=. --remote=origin --push
  else
    gh repo create "${OWNER}/${REPO}" --public --source=. --remote=origin --push
  fi
fi

if git remote get-url origin >/dev/null 2>&1; then
  git remote set-url origin "https://github.com/${OWNER}/${REPO}.git"
else
  git remote add origin "https://github.com/${OWNER}/${REPO}.git"
fi

git push -u origin "${BRANCH}"

echo ""
echo "Done. Open repository:"
echo "https://github.com/${OWNER}/${REPO}"
