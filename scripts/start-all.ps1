param(
  [switch]$KillPorts
)

$ErrorActionPreference = 'SilentlyContinue'
$root = (Get-Item $PSScriptRoot).Parent.FullName
$ports = @(3000,3001,3002,3011,3012)

function Stop-Port($port){
  $conns = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
  if($conns){
    $pids = $conns | Select-Object -ExpandProperty OwningProcess | Sort-Object -Unique
    foreach($pid in $pids){
      if($pid -and $pid -ne 0){
        try { Write-Host "Stopping PID $pid on port $port"; Stop-Process -Id $pid -Force } catch {}
      }
    }
  }
}

if($KillPorts){
  foreach($p in $ports){ Stop-Port $p }
}

Write-Host "Launching API (3002)"
Start-Process powershell -ArgumentList "-NoExit","-Command","cd `"$root\server`"; node server.js"

Write-Host "Launching Connect Four WS (3001)"
Start-Process powershell -ArgumentList "-NoExit","-Command","cd `"$root\src\components\games\ConnectFour`"; node server.js"

Write-Host "Launching Checkers WS (3011)"
Start-Process powershell -ArgumentList "-NoExit","-Command","cd `"$root\src\components\games\Checkers`"; node server.js"

Write-Host "Launching Chess WS (3012)"
Start-Process powershell -ArgumentList "-NoExit","-Command","cd `"$root\src\components\games\Chess`"; node server.js"

Write-Host "Launching React dev server (CRA on 3000)"
Start-Process powershell -ArgumentList "-NoExit","-Command","cd `"$root`"; npm start"

Write-Host "All servers started in separate PowerShell windows."