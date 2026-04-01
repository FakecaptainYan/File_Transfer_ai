param(
  [Parameter(Mandatory = $true)]
  [string]$ProductName,

  [Parameter(Mandatory = $true)]
  [string]$InstallDirName,

  [Parameter(Mandatory = $true)]
  [string]$AppExecutableName
)

$ErrorActionPreference = "Stop"

function Get-UninstallEntries {
  $roots = @(
    "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall",
    "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall",
    "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"
  )

  $entries = foreach ($root in $roots) {
    if (-not (Test-Path -LiteralPath $root)) {
      continue
    }

    Get-ChildItem -LiteralPath $root -ErrorAction SilentlyContinue | ForEach-Object {
      try {
        Get-ItemProperty -LiteralPath $_.PSPath -ErrorAction Stop
      } catch {
      }
    }
  }

  return @($entries | Where-Object {
    $_ -and (
      ($_.DisplayName -and $_.DisplayName -like "$ProductName*") -or
      ($_.InstallLocation -and $_.InstallLocation -like "*\$InstallDirName") -or
      ($_.UninstallString -and $_.UninstallString -like "*\$InstallDirName*") -or
      ($_.QuietUninstallString -and $_.QuietUninstallString -like "*\$InstallDirName*")
    )
  })
}

function Split-CommandLine {
  param([string]$CommandLine)

  $value = [string]$CommandLine
  if ([string]::IsNullOrWhiteSpace($value)) {
    return $null
  }

  $trimmed = $value.Trim()
  if ($trimmed.StartsWith('"')) {
    $endQuote = $trimmed.IndexOf('"', 1)
    if ($endQuote -lt 1) {
      return $null
    }

    return [pscustomobject]@{
      FilePath = $trimmed.Substring(1, $endQuote - 1)
      Arguments = $trimmed.Substring($endQuote + 1).Trim()
    }
  }

  $firstSpace = $trimmed.IndexOf(" ")
  if ($firstSpace -lt 0) {
    return [pscustomobject]@{
      FilePath = $trimmed
      Arguments = ""
    }
  }

  return [pscustomobject]@{
    FilePath = $trimmed.Substring(0, $firstSpace)
    Arguments = $trimmed.Substring($firstSpace + 1).Trim()
  }
}

function Stop-ProductProcesses {
  param(
    [string]$ExecutableName,
    [string[]]$InstallRoots
  )

  $processBaseName = [System.IO.Path]::GetFileNameWithoutExtension($ExecutableName)
  $rootSet = @($InstallRoots | Where-Object { $_ } | Select-Object -Unique)

  $targets = Get-Process -ErrorAction SilentlyContinue | Where-Object {
    if ($_.ProcessName -eq $processBaseName) {
      return $true
    }

    if (-not $_.Path -or $rootSet.Count -eq 0) {
      return $false
    }

    foreach ($root in $rootSet) {
      if ($root -and $_.Path -like "$($root.TrimEnd('\'))\*") {
        return $true
      }
    }

    return $false
  }

  foreach ($target in @($targets)) {
    try {
      Stop-Process -Id $target.Id -Force -ErrorAction Stop
    } catch {
    }
  }
}

function Remove-InstallArtifacts {
  param(
    [string]$Product,
    [string[]]$InstallRoots,
    [object[]]$Entries
  )

  foreach ($installRoot in @($InstallRoots | Where-Object { $_ } | Select-Object -Unique)) {
    if (Test-Path -LiteralPath $installRoot) {
      Remove-Item -LiteralPath $installRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
  }

  $shortcutCandidates = @(
    (Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\$Product.lnk"),
    (Join-Path $env:USERPROFILE "Desktop\$Product.lnk"),
    (Join-Path $env:PUBLIC "Desktop\$Product.lnk")
  )

  foreach ($shortcut in $shortcutCandidates) {
    if (Test-Path -LiteralPath $shortcut) {
      Remove-Item -LiteralPath $shortcut -Force -ErrorAction SilentlyContinue
    }
  }

  foreach ($entry in @($Entries)) {
    if ($entry.PSPath) {
      $registryPath = $entry.PSPath -replace "^Microsoft\.PowerShell\.Core\\Registry::", "Registry::"
      if (Test-Path -LiteralPath $registryPath) {
        Remove-Item -LiteralPath $registryPath -Recurse -Force -ErrorAction SilentlyContinue
      }
    }
  }
}

$entries = Get-UninstallEntries
if ($entries.Count -eq 0) {
  exit 0
}

$installRoots = @(
  $entries | ForEach-Object {
    if ($_.InstallLocation) {
      $_.InstallLocation.TrimEnd("\")
    } elseif ($_.UninstallString) {
      $parsed = Split-CommandLine $_.UninstallString
      if ($parsed -and $parsed.FilePath) {
        Split-Path -Parent $parsed.FilePath
      }
    }
  }
) | Where-Object { $_ } | Select-Object -Unique

Stop-ProductProcesses -ExecutableName $AppExecutableName -InstallRoots $installRoots
Start-Sleep -Milliseconds 500

foreach ($entry in $entries) {
  $commandLine = if ($entry.QuietUninstallString) { $entry.QuietUninstallString } else { $entry.UninstallString }
  $parsed = Split-CommandLine $commandLine
  if (-not $parsed -or -not $parsed.FilePath -or -not (Test-Path -LiteralPath $parsed.FilePath)) {
    continue
  }

  $arguments = $parsed.Arguments
  if ($arguments -notmatch '(^|\s)/S(\s|$)') {
    $arguments = "$arguments /S".Trim()
  }

  try {
    Start-Process -FilePath $parsed.FilePath -ArgumentList $arguments -Wait -WindowStyle Hidden
  } catch {
  }
}

Start-Sleep -Seconds 1
Stop-ProductProcesses -ExecutableName $AppExecutableName -InstallRoots $installRoots
Remove-InstallArtifacts -Product $ProductName -InstallRoots $installRoots -Entries $entries

$remainingEntries = Get-UninstallEntries
$remainingInstallRoots = @($installRoots | Where-Object { $_ -and (Test-Path -LiteralPath $_) })

if ($remainingEntries.Count -gt 0 -or $remainingInstallRoots.Count -gt 0) {
  exit 1
}

exit 0
