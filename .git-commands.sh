#!/usr/bin/env bash
set -e

# Fetch latest remote refs
git fetch origin

# Ensure neon-games branch exists locally, create from origin/main if not
if git rev-parse --verify --quiet neon-games >/dev/null; then
  echo "Checking out existing local 'neon-games'..."
  git checkout neon-games
else
  echo "Creating 'neon-games' from origin/main..."
  git checkout -b neon-games origin/main
fi

# If branch already has an upstream, show it and exit
if git rev-parse --abbrev-ref --symbolic-full-name @{u} >/dev/null 2>&1; then
  echo "Upstream already configured: $(git rev-parse --abbrev-ref --symbolic-full-name @{u})"
  exit 0
fi

# If remote origin/neon-games exists, set local branch to track it
if git ls-remote --exit-code --heads origin neon-games >/dev/null 2>&1; then
  echo "Remote branch origin/neon-games found — setting local upstream..."
  git branch --set-upstream-to=origin/neon-games neon-games
  echo "Pulling remote changes (fast-forward only)..."
  git pull --ff-only
else
  # Otherwise push local branch and set upstream
  echo "Pushing 'neon-games' to origin and setting upstream..."
  git push -u origin neon-games
fi

echo "Branch 'neon-games' is now set to track origin/neon-games."
