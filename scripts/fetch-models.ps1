param(
  [string]$Dest = "../public/models"
)

$ErrorActionPreference = "Stop"

function Ensure-Dir($p){ if(!(Test-Path $p)){ New-Item -ItemType Directory -Force -Path $p | Out-Null } }

$root = Resolve-Path $PSScriptRoot
$models = Join-Path $root $Dest
$chess = Join-Path $models "chess"
$checkers = Join-Path $models "checkers"
Ensure-Dir $models
Ensure-Dir $chess
Ensure-Dir $checkers

Write-Host "Downloading chess assets into: $models"

# Source: OpenGameArt - Low Poly Chess Set (CC-BY 4.0) by JustinARay
$zipUrl = "https://opengameart.org/sites/default/files/3D%20Low%20Poly%20Chess%20Set%20Package.zip"
$zipPath = Join-Path $env:TEMP "chess_pack.zip"
$extractDir = Join-Path $env:TEMP "chess_pack_extracted_$(Get-Random)"
Ensure-Dir $extractDir

try{
  Write-Host "Fetching chess pack ZIP..."
  Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -UseBasicParsing
  Write-Host "Extracting..."
  Expand-Archive -LiteralPath $zipPath -DestinationPath $extractDir -Force
}catch{
  Write-Warning "Failed to download/extract chess pack: $_"
}

# Try to locate FBX files by name
$pieceMap = @{
  pawn   = 'pawn';
  rook   = 'rook';
  knight = 'knight|horse';
  bishop = 'bishop';
  queen  = 'queen';
  king   = 'king';
}

Get-ChildItem -Path $extractDir -Recurse -File | ForEach-Object {
  $_ | Out-Null
}

foreach($kv in $pieceMap.GetEnumerator()){
  $name = $kv.Key
  $pattern = $kv.Value
  $candidate = Get-ChildItem -Path $extractDir -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Extension -match '^\.fbx$' -and $_.Name -match $pattern }
  if($candidate){
    $dst = Join-Path $chess ("{0}.fbx" -f $name)
    if(!(Test-Path $dst)){
      Copy-Item -LiteralPath $candidate[0].FullName -Destination $dst -Force
      Write-Host "Added: $dst"
    } else {
      Write-Host "Exists: $dst"
    }
  } else {
    Write-Warning "Could not find FBX for $name in extracted pack."
  }
}

# Write attribution
$attribPath = Join-Path $models "ATTRIBUTION.md"
$attribContent = @"
Chess models: Low Poly Chess Set by JustinARay (OpenGameArt)
License: CC-BY 4.0 - https://creativecommons.org/licenses/by/4.0/
Source: https://opengameart.org/content/low-poly-chess-set

Checkers pieces: currently procedural (rendered in code). Optionally drop GLB/FBX into models/checkers/man.glb and king.glb (or .fbx).
"@
$attribContent | Set-Content -LiteralPath $attribPath -Encoding UTF8

Write-Host "Done. Place optional checkers models under $checkers as man.glb/king.glb (or .fbx)."
