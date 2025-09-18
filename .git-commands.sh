#!/usr/bin/env bash
set -e

# 1) Ensure we have latest remote refs
git fetch origin

# 2) Create a new branch 'neon-games' based on origin/main
# If you already have a local neon-games, this will error — the fallback checks out the existing branch.
if git show-ref --verify --quiet refs/heads/neon-games; then
  echo "Local branch 'neon-games' already exists — checking it out."
  git checkout neon-games
else
  echo "Creating 'neon-games' from origin/main..."
  git checkout -b neon-games origin/main
fi

# 3) Optionally include current working changes:
# If you want to include any uncommitted changes automatically, uncomment the next lines:
# if [ -n "$(git status --porcelain)" ]; then
#   git add .
#   git commit -m "Start neon-games branch with LED/theme updates"
# fi

# 4) Push and set upstream
git push -u origin neon-games

echo "Branch 'neon-games' created (or checked out) and pushed. You are now on neon-games."
