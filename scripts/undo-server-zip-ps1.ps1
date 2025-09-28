# Usage: run the section you need in PowerShell (paste into VS Code terminal).
# A) If the bad commit is LOCAL and NOT PUSHED (simplest)
Set-Location 'C:\Users\victo\CardGame'

# add to .gitignore if not present
if (-not (Test-Path .gitignore) -or -not (Select-String -Path .gitignore -Pattern '^server\.zip$' -Quiet -ErrorAction SilentlyContinue)) {
  Add-Content -Path .gitignore -Value "server.zip"
  git add .gitignore
  Write-Output "Added server.zip to .gitignore"
} else {
  Write-Output ".gitignore already contains server.zip"
}

# remove server.zip from the index but keep local file
git rm --cached -f server.zip 2>$null
git commit --amend --no-edit

# verify
git show --name-only HEAD
git status --porcelain

# -----------------------------------------------------
# B) If the bad commit WAS ALREADY PUSHED (rewrite history)
# WARNING: rewrites history. Backup and inform collaborators.

Set-Location 'C:\Users\victo\CardGame'

# ensure ignore + local removal
if (-not (Select-String -Path .gitignore -Pattern '^server\.zip$' -Quiet -ErrorAction SilentlyContinue)) {
  Add-Content -Path .gitignore -Value "server.zip"
  git add .gitignore
}
git rm --cached -f server.zip 2>$null
try { git commit -m "Ignore server.zip and remove from index (keep local copy)" } catch { Write-Output "No commit created (no staged changes)." }

# get origin URL
$remote = git config --get remote.origin.url
if (-not $remote) { Write-Error "No origin remote configured. Set origin and retry."; break }

# require git-filter-repo installed
if (-not (Get-Command git-filter-repo -ErrorAction SilentlyContinue)) {
  Write-Error "git-filter-repo not found. Install via: pip install git-filter-repo"
  break
}

# create bare mirror backup
$ts = (Get-Date).ToString("yyyyMMdd-HHmmss")
$mirrorDir = Join-Path (Get-Location) ("repo-mirror-$ts.git")
git clone --mirror $remote $mirrorDir

# run filter-repo in mirror
Push-Location $mirrorDir
git filter-repo --invert-paths --path server.zip
# force-push cleaned history
git push --force --all
git push --force --tags
Pop-Location

Write-Output "Finished. Mirror backup at: $mirrorDir"
Write-Output "IMPORTANT: Delete your local clone and re-clone from origin. Inform collaborators to reclone."
