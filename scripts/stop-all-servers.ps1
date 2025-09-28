$ErrorActionPreference = 'SilentlyContinue'
$ports = @(3002,3011,3012)
foreach($port in $ports){
  try{
    $conns = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
    if($conns){
      $pids = $conns | Select-Object -ExpandProperty OwningProcess | Sort-Object -Unique
      foreach($pid in $pids){ if($pid){ try { Stop-Process -Id $pid -Force } catch {} } }
    }
  }catch{}
}
Write-Host "Stopped servers on ports: $($ports -join ', ')"