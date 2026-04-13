param(
  [Parameter(Mandatory=$true)][string]$SnapshotDir,
  [string]$MySqlPath = 'C:\laragon\bin\mysql\mysql-8.4.3-winx64\bin\mysql.exe',
  [string]$DbHost = '127.0.0.1',
  [int]$DbPort = 3306,
  [string]$DbUser = 'root',
  [string]$DbName = 'doc_signature'
)

$ErrorActionPreference = 'Stop'
$sqlFile = Join-Path $SnapshotDir 'doc_signature.sql'
if (!(Test-Path $sqlFile)) { throw "SQL dump introuvable: $sqlFile" }
if (!(Test-Path $MySqlPath)) { throw "mysql introuvable: $MySqlPath" }

Get-Content $sqlFile | & $MySqlPath -h $DbHost -P $DbPort -u $DbUser $DbName
if ($LASTEXITCODE -ne 0) { throw 'Echec de restauration SQL' }

Write-Output "Restauration terminee depuis: $SnapshotDir"
