$ErrorActionPreference = 'Stop'

# Stop old listeners if any
$ports = 3000,4200,4201,4202,4203
$pids = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
  Where-Object { $ports -contains $_.LocalPort } |
  Select-Object -ExpandProperty OwningProcess -Unique
if ($pids) {
  $pids | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
}

# Start backend and frontend in separate windows
Start-Process powershell -ArgumentList '-NoExit','-Command','npm --prefix c:\Users\MCN\Documents\doc_signature\backend run start:dev'
Start-Process powershell -ArgumentList '-NoExit','-Command','npm --prefix c:\Users\MCN\Documents\doc_signature\frontend start'

Write-Output 'Services launched:'
Write-Output '- Backend:  http://localhost:3000'
Write-Output '- Frontend: http://localhost:4200'
Write-Output '- Swagger:  http://localhost:3000/docs'
