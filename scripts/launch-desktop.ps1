param()

$ErrorActionPreference = "Stop"

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$appRoot = Split-Path -Parent $scriptRoot
$url = "http://127.0.0.1:3000"
$statusUrl = "$url/api/status"

function Test-AppServer {
  try {
    $response = Invoke-WebRequest -Uri $statusUrl -UseBasicParsing -TimeoutSec 2
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Get-NodePath {
  $nodeCommand = Get-Command node -ErrorAction Stop
  return $nodeCommand.Source
}

function Get-AppBrowserPath {
  $programFilesX86 = [Environment]::GetFolderPath("ProgramFilesX86")
  $programFiles = [Environment]::GetFolderPath("ProgramFiles")

  $candidates = @(
    (Join-Path $programFilesX86 "Microsoft\Edge\Application\msedge.exe"),
    (Join-Path $programFiles "Microsoft\Edge\Application\msedge.exe"),
    (Join-Path $programFilesX86 "Google\Chrome\Application\chrome.exe"),
    (Join-Path $programFiles "Google\Chrome\Application\chrome.exe")
  )

  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) {
      return $candidate
    }
  }

  return $null
}

if (-not (Test-AppServer)) {
  $nodePath = Get-NodePath
  Start-Process -FilePath $nodePath -ArgumentList "server.js" -WorkingDirectory $appRoot -WindowStyle Hidden

  for ($index = 0; $index -lt 30; $index++) {
    Start-Sleep -Milliseconds 500
    if (Test-AppServer) {
      break
    }
  }
}

$browserPath = Get-AppBrowserPath

if ($browserPath) {
  $profileDir = Join-Path $env:TEMP "AppleMediaConverterProfile"
  New-Item -ItemType Directory -Path $profileDir -Force | Out-Null
  Start-Process -FilePath $browserPath -ArgumentList "--app=$url", "--user-data-dir=$profileDir"
} else {
  Start-Process $url
}
