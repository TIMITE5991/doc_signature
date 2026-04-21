$ErrorActionPreference = 'Stop'

$root = 'c:\Users\MCN\Documents\doc_signature'
$laragonPath = 'C:\laragon\laragon.exe'

function Test-PortListening([int]$Port) {
  return @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalPort -eq $Port }).Count -gt 0
}

# Stop old listeners if any
$ports = 3000,4200,4201,4202,4203
$pids = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
  Where-Object { $ports -contains $_.LocalPort } |
  Select-Object -ExpandProperty OwningProcess -Unique
if ($pids) {
  $pids | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
}

# Start Laragon/MySQL if available and not already listening
if ((Test-Path $laragonPath) -and -not (Test-PortListening 3306)) {
  Start-Process $laragonPath
  for ($i = 0; $i -lt 20; $i++) {
    if (Test-PortListening 3306) { break }
    Start-Sleep -Milliseconds 500
  }
}

# Start backend and frontend in separate windows
Start-Process powershell -ArgumentList '-NoExit','-Command',"npm --prefix $root\backend run start:dev"
Start-Process powershell -ArgumentList '-NoExit','-Command',"npm --prefix $root\frontend start"

Write-Output 'Services launched:'
Write-Output '- Database: http://localhost:3306 (MySQL)'
Write-Output '- Backend:  http://localhost:3000'
Write-Output '- Frontend: http://localhost:4200'
Write-Output '- Swagger:  http://localhost:3000/docs'
