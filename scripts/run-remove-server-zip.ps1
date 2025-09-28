# Usage (from repo root in PowerShell):
#   powershell -ExecutionPolicy Bypass -File .\scripts\run-remove-server-zip.ps1
# or paste the contents below into your VS Code terminal.

Set-StrictMode -Version Latest

if (-not (Test-Path -Path ".git")) {
  Write-Error "Run this from the repository root (folder containing .git)."
  exit 1
}

# --- replaced: robust detection + optional auto-install + chosen invocation ---
function Ensure-GitFilterRepo {
  param(
    [ref]$Cmd,    # returns either 'git-filter-repo' or the python executable path
    [ref]$IsModule # returns $true if $Cmd should be used as "python -m git_filter_repo"
  )
  $Cmd.Value = $null
  $IsModule.Value = $false

  # 1) If git-filter-repo is on PATH, use it
  $exe = Get-Command git-filter-repo -ErrorAction SilentlyContinue
  if ($exe) {
    $Cmd.Value = "git-filter-repo"
    $IsModule.Value = $false
    return $true
  }

  # 2) Try python interpreters: check for module first, else attempt pip install then re-check
  $pyCandidates = @('python','python3','py')
  foreach ($py in $pyCandidates) {
    $pyCmd = Get-Command $py -ErrorAction SilentlyContinue
    if (-not $pyCmd) { continue }

    try {
      # check if module is present
      & $py -c "import importlib.util, sys; sys.exit(0 if importlib.util.find_spec('git_filter_repo') else 1)"
      if ($LASTEXITCODE -eq 0) {
        $Cmd.Value = $py
        $IsModule.Value = $true
        return $true
      }

      # try to auto-install per-user
      Write-Output "Attempting to install git-filter-repo via: $py -m pip install --user git-filter-repo"
      & $py -m pip install --user git-filter-repo 2>&1 | Out-Host

      # re-check for module
      & $py -c "import importlib.util, sys; sys.exit(0 if importlib.util.find_spec('git_filter_repo') else 1)"
      if ($LASTEXITCODE -eq 0) {
        $Cmd.Value = $py
        $IsModule.Value = $true
        return $true
      }
    } catch {
      Write-Output "Attempt with $py failed: $($_.Exception.Message)"
    }
  }

  # 3) try plain pip if available
  if (Get-Command pip -ErrorAction SilentlyContinue) {
    try {
      Write-Output "Attempting: pip install --user git-filter-repo"
      pip install --user git-filter-repo 2>&1 | Out-Host
      # don't know which python this pip belongs to, try 'python' fallback
      if (Get-Command python -ErrorAction SilentlyContinue) {
        & python -c "import importlib.util, sys; sys.exit(0 if importlib.util.find_spec('git_filter_repo') else 1)"
        if ($LASTEXITCODE -eq 0) {
          $Cmd.Value = "python"
          $IsModule.Value = $true
          return $true
        }
      }
    } catch {}
  }

  # failed
  return $false
}

# call the helper and get the invocation method
$gfrCmd = $null
$gfrIsModule = $false
if (-not (Ensure-GitFilterRepo -Cmd ([ref]$gfrCmd) -IsModule ([ref]$gfrIsModule))) {
  Write-Error "git-filter-repo not found and automatic install failed."
  Write-Output "Manual install steps (run in PowerShell):"
  Write-Output "  1) Install Python (https://www.python.org/downloads/) and ensure 'python' is on PATH."
  Write-Output "  2) Run: python -m pip install --user git-filter-repo"
  Write-Output "  3) Restart PowerShell and re-run this script."
  Write-Output ""
  Write-Output "Alternative (BFG): https://rtyley.github.io/bfg-repo-cleaner/"
  exit 1
}

# 2) Add server.zip to .gitignore and untrack it locally (keep local copy)
if (-not (Test-Path .gitignore)) { New-Item -Path .gitignore -ItemType File -Force | Out-Null }
if (-not (Select-String -Path .gitignore -Pattern '^server\.zip$' -SimpleMatch -Quiet -ErrorAction SilentlyContinue)) {
  Add-Content -Path .gitignore -Value "server.zip"
  git add .gitignore
  Write-Output "Added server.zip to .gitignore"
} else {
  Write-Output ".gitignore already contains server.zip"
}

# Remove from index (keep working copy)
try { git rm --cached -f server.zip } catch { Write-Output "server.zip not tracked or removal from index failed (continuing)"; }

# Commit the .gitignore change if there are staged changes
try {
  git commit -m "Ignore server.zip and remove from index (keep local copy)" -q
  Write-Output "Committed .gitignore change"
} catch {
  Write-Output "No commit created (no staged changes)."
}

# 3) Mirror remote (backup) and run filter
$remote = git config --get remote.origin.url
if (-not $remote) {
  Write-Error "No origin remote configured. Set remote.origin.url and retry."
  exit 1
}

Write-Output "About to create a bare mirror of origin ($remote) as a backup."
$confirm = Read-Host "Proceed to create mirror and remove server.zip from history? This rewrites history and force-pushes. Type 'y' to continue"
if ($confirm -ne 'y') { Write-Output "Aborted by user."; exit 0 }

$ts = (Get-Date).ToString("yyyyMMdd-HHmmss")
$mirrorDir = Join-Path (Get-Location) ("repo-mirror-$ts.git")
Write-Output "Cloning bare mirror to: $mirrorDir"
git clone --mirror $remote $mirrorDir

Push-Location $mirrorDir

Write-Output "Running git-filter-repo to remove path 'server.zip' from all commits..."
if ($gfrIsModule) {
  # run as: python -m git_filter_repo ...
  & $gfrCmd -m git_filter_repo --invert-paths --path server.zip
} else {
  # run as: git-filter-repo ...
  & $gfrCmd --invert-paths --path server.zip
}

Write-Output "Force-pushing cleaned history to origin..."
git push --force --all
git push --force --tags

Pop-Location

Write-Output ""
Write-Output "Done. Mirror backup retained at: $mirrorDir"
Write-Output "IMPORTANT:"
Write-Output " - Delete or move your current local clone and re-clone from origin:"
Write-Output "     git clone $remote CardGame"
Write-Output " - Recreate your working branch from origin/main (example):"
Write-Output "     git fetch origin"
Write-Output "     git checkout -b neon origin/main"
Write-Output " - Inform collaborators to reclone (history was rewritten)."
