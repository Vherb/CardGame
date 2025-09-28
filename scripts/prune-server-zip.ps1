# Usage: open PowerShell in repo root and run:
#   powershell -ExecutionPolicy Bypass -File .\scripts\prune-server-zip.ps1
# This will rewrite history and force-push. Backup first.

Write-Output "Step 1: Ignore and untrack server.zip locally..."
if (-not (Test-Path .git)) { Write-Error "Run this from your repository root."; exit 1 }
if (-not (Select-String -Path .gitignore -Pattern '^server\.zip$' -Quiet -ErrorAction SilentlyContinue)) {
  Add-Content -Path .gitignore -Value "server.zip"
  git add .gitignore
  Write-Output "Added server.zip to .gitignore"
} else {
  Write-Output ".gitignore already contains server.zip"
}

# remove from index (keep local file)
git rm --cached -f server.zip 2>$null
try { git commit -m "Ignore server.zip and remove from index (keep local copy)" -q } catch { Write-Output "No commit created (no staged changes)." }

Write-Output "`nStep 2: Ensure git-filter-repo is available..."
if (-not (Get-Command git-filter-repo -ErrorAction SilentlyContinue)) {
  Write-Error "git-filter-repo not found. Install via: pip install git-filter-repo. Aborting."
  exit 1
}

$remote = git config --get remote.origin.url
if (-not $remote) { Write-Error "No origin remote configured. Set origin and retry."; exit 1 }

$confirm = Read-Host "This WILL rewrite history and force-push to origin. Make sure you/backups exist. Continue? (y/N)"
if ($confirm -ne 'y' -and $confirm -ne 'Y') { Write-Output "Aborting."; exit 0 }

Write-Output "`nStep 3: Create a bare mirror backup..."
$ts = (Get-Date).ToString("yyyyMMdd-HHmmss")
$mirrorDir = Join-Path (Get-Location) ("repo-mirror-$ts.git")
git clone --mirror $remote $mirrorDir

Write-Output "`nStep 4: Run git-filter-repo to remove server.zip from all commits (mirror path: $mirrorDir)..."
Push-Location $mirrorDir
git filter-repo --invert-paths --path server.zip

Write-Output "`nStep 5: Force-push cleaned history to origin..."
git push --force --all
git push --force --tags
Pop-Location

Write-Output "`nDone. Mirror backup retained at: $mirrorDir"
Write-Output "IMPORTANT: Delete or move your current local clone and re-clone from origin:"
Write-Output "  git clone $remote CardGame"
Write-Output "Then recreate neon branch if needed:"
Write-Output "  git fetch origin"
Write-Output "  git checkout -b neon origin/main"
