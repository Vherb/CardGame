param(
  [int[]]$Ports = @(3002,3011,3012)
)

$ErrorActionPreference = 'SilentlyContinue'
$root = Split-Path -Parent $PSScriptRoot
$logs = Join-Path $root 'logs'
New-Item -ItemType Directory -Path $logs -Force | Out-Null

function Kill-Ports([int[]]$p){
  foreach($port in $p){
    try{
      $conns = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
      if($conns){
        $pids = $conns | Select-Object -ExpandProperty OwningProcess | Sort-Object -Unique
        foreach($pid in $pids){ if($pid){ try { Stop-Process -Id $pid -Force } catch {} } }
      }
    }catch{}
  }
}

Write-Host "Freeing ports: $($Ports -join ', ')"
Kill-Ports -p $Ports

# Start API
$apiLog = Join-Path $logs 'api.log'
Write-Host "Starting API (3002) ... logs: $apiLog"
Start-Process -FilePath powershell.exe -WorkingDirectory $root -ArgumentList "-NoLogo","-NoProfile","-Command","npm run serve:api | Tee-Object -FilePath `"$apiLog`" -Append" -WindowStyle Minimized

# Start Checkers
$chkLog = Join-Path $logs 'checkers.log'
Write-Host "Starting Checkers (3011) ... logs: $chkLog"
Start-Process -FilePath powershell.exe -WorkingDirectory $root -ArgumentList "-NoLogo","-NoProfile","-Command","npm run serve:checkers | Tee-Object -FilePath `"$chkLog`" -Append" -WindowStyle Minimized

# Start Chess
$chessLog = Join-Path $logs 'chess.log'
Write-Host "Starting Chess (3012) ... logs: $chessLog"
Start-Process -FilePath powershell.exe -WorkingDirectory $root -ArgumentList "-NoLogo","-NoProfile","-Command","npm run serve:chess | Tee-Object -FilePath `"$chessLog`" -Append" -WindowStyle Minimized

# Simple health checks (API only here; Chess WS has /health on HTTP)
Start-Sleep -Seconds 2
try{ $api = (Invoke-WebRequest -UseBasicParsing http://localhost:3002/ping).StatusCode } catch { $api = 'ERR' }
try{ $chess = (Invoke-WebRequest -UseBasicParsing http://localhost:3012/health).StatusCode } catch { $chess = 'ERR' }

Write-Host "API /ping => $api"
Write-Host "Chess /health => $chess"
Write-Host "Servers launched. Use scripts/stop-all-servers.ps1 to stop."