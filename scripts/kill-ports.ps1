Param(
  [int[]]$Ports = @(3000,5000,3001,3002,3011,3012)
)

Write-Host "Checking listeners on ports: $($Ports -join ', ')" -ForegroundColor Cyan
foreach ($p in $Ports) {
  try {
    $conns = Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue
    if ($conns) {
      $pids = $conns | Select-Object -ExpandProperty OwningProcess -Unique
      foreach ($procId in $pids) {
        try { Stop-Process -Id $procId -Force -ErrorAction Stop } catch {}
      }
      Write-Host "Cleared port $p" -ForegroundColor Green
    } else {
      Write-Host "No listener on port $p" -ForegroundColor DarkGray
    }
  } catch {
    Write-Host "Error inspecting port ${p}: $($_.Exception.Message)" -ForegroundColor Yellow
  }
}

Write-Host "Done." -ForegroundColor Cyan
