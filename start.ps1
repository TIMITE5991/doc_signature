$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$script = Join-Path $root 'scripts\start-stable.ps1'

if (!(Test-Path $script)) {
  throw "Script introuvable: $script"
}

& $script
