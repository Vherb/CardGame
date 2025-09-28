Param(
  [switch]$Api = $true,
  [switch]$Checkers = $true,
  [switch]$Chess = $true
)

$ErrorActionPreference = 'SilentlyContinue'

& "$PSScriptRoot\kill-ports.ps1" -Ports @(3002,3011,3012) | Out-Null

Function Start-ServerTab {
  Param([string]$Title,[string]$Cmd)
  $cmdLine = "powershell -NoLogo -NoProfile -Command `"cd /d `"$PWD`"; $Cmd`""
  Start-Process -FilePath "cmd.exe" -ArgumentList "/k title $Title && $cmdLine"
}

if ($Api) { Start-ServerTab -Title "API :3002" -Cmd "npm run serve:api" }
if ($Checkers) { Start-ServerTab -Title "Checkers :3011" -Cmd "npm run serve:checkers" }
if ($Chess) { Start-ServerTab -Title "Chess :3012" -Cmd "npm run serve:chess" }

Write-Host "Launched requested servers." -ForegroundColor Cyan
