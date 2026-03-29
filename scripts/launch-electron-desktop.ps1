param()

$ErrorActionPreference = "Stop"

$electronDistPath = [Environment]::GetEnvironmentVariable("ELECTRON_OVERRIDE_DIST_PATH", "User")
if ([string]::IsNullOrWhiteSpace($electronDistPath)) {
  throw "ELECTRON_OVERRIDE_DIST_PATH is not set."
}

$electronExe = Join-Path $electronDistPath "electron.exe"
if (!(Test-Path $electronExe)) {
  throw "electron.exe not found at $electronExe"
}

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$appRoot = Split-Path -Parent $scriptRoot

Start-Process -FilePath $electronExe -ArgumentList $appRoot -WorkingDirectory $appRoot
