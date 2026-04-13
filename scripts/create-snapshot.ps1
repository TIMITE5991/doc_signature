param(
  [string]$MySqlDumpPath = 'C:\laragon\bin\mysql\mysql-8.4.3-winx64\bin\mysqldump.exe',
  [string]$DbHost = '127.0.0.1',
  [int]$DbPort = 3306,
  [string]$DbUser = 'root',
  [string]$DbName = 'doc_signature'
)

$ErrorActionPreference = 'Stop'
$root = 'c:\Users\MCN\Documents\doc_signature'
$snapRoot = Join-Path $root 'snapshots'
$ts = Get-Date -Format 'yyyyMMdd_HHmmss'
$snapDir = Join-Path $snapRoot $ts
New-Item -ItemType Directory -Force -Path $snapDir | Out-Null

if (!(Test-Path $MySqlDumpPath)) { throw "mysqldump introuvable: $MySqlDumpPath" }

& $MySqlDumpPath -h $DbHost -P $DbPort -u $DbUser $DbName > (Join-Path $snapDir 'doc_signature.sql')
if ($LASTEXITCODE -ne 0) { throw 'Echec du dump SQL' }

$zipPath = Join-Path $snapDir 'app_source.zip'
$items = Get-ChildItem $root -Force | Where-Object { $_.Name -notin @('node_modules','snapshots') -and $_.FullName -notlike '*\node_modules\*' }
Compress-Archive -Path ($items.FullName) -DestinationPath $zipPath -Force

Write-Output "Snapshot created: $snapDir"
Write-Output "- SQL: $snapDir\doc_signature.sql"
Write-Output "- ZIP: $zipPath"
