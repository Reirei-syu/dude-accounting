[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('Add', 'Remove')]
  [string]$Action,

  [Parameter(Mandatory = $true)]
  [string]$InstallDir,

  [string]$OldInstallDir = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Get-PathEntryText {
  param(
    [AllowNull()]
    [string]$Value
  )

  if ([string]::IsNullOrWhiteSpace($Value)) {
    return ''
  }

  $trimmed = $Value.Trim().Trim('"')
  if ([string]::IsNullOrWhiteSpace($trimmed)) {
    return ''
  }

  if ($trimmed.Length -gt 3) {
    return $trimmed.TrimEnd('\')
  }

  return $trimmed
}

function Normalize-PathEntry {
  param(
    [AllowNull()]
    [string]$Value
  )

  $entryText = Get-PathEntryText $Value
  if ([string]::IsNullOrWhiteSpace($entryText)) {
    return ''
  }

  $expanded = [Environment]::ExpandEnvironmentVariables($entryText)
  if ($expanded -match '%[^%]+%') {
    return $entryText
  }

  try {
    $fullPath = [System.IO.Path]::GetFullPath($expanded)
  } catch {
    $fullPath = $expanded
  }

  if ($fullPath.Length -gt 3) {
    return $fullPath.TrimEnd('\')
  }

  return $fullPath
}

function Get-UserPathEntries {
  $rawPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  if ([string]::IsNullOrWhiteSpace($rawPath)) {
    return @()
  }

  return $rawPath.Split(';', [System.StringSplitOptions]::RemoveEmptyEntries)
}

function Broadcast-EnvironmentChange {
  if (-not ('CliPathBroadcast.NativeMethods' -as [type])) {
    Add-Type -Namespace 'CliPathBroadcast' -Name 'NativeMethods' -MemberDefinition @'
using System;
using System.Runtime.InteropServices;

public static class NativeMethods
{
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern IntPtr SendMessageTimeout(
        IntPtr hWnd,
        uint Msg,
        UIntPtr wParam,
        string lParam,
        uint fuFlags,
        uint uTimeout,
        out UIntPtr lpdwResult
    );
}
'@
  }

  $nullResult = [UIntPtr]::Zero
  [void][CliPathBroadcast.NativeMethods]::SendMessageTimeout(
    [IntPtr]0xffff,
    0x1A,
    [UIntPtr]::Zero,
    'Environment',
    0x0002,
    5000,
    [ref]$nullResult
  )
}

$normalizedInstallDir = Normalize-PathEntry $InstallDir
if ([string]::IsNullOrWhiteSpace($normalizedInstallDir)) {
  throw 'InstallDir 不能为空。'
}

$normalizedOldInstallDir = Normalize-PathEntry $OldInstallDir
$entries = [System.Collections.Generic.List[string]]::new()
$seen = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)

foreach ($entry in Get-UserPathEntries) {
  $entryText = Get-PathEntryText $entry
  $normalizedEntry = Normalize-PathEntry $entryText
  if ([string]::IsNullOrWhiteSpace($normalizedEntry)) {
    continue
  }

  if (
    ($normalizedOldInstallDir -and $normalizedEntry.Equals($normalizedOldInstallDir, [System.StringComparison]::OrdinalIgnoreCase)) -or
    $normalizedEntry.Equals($normalizedInstallDir, [System.StringComparison]::OrdinalIgnoreCase)
  ) {
    continue
  }

  if ($seen.Add($normalizedEntry)) {
    [void]$entries.Add($entryText)
  }
}

if ($Action -eq 'Add' -and $seen.Add($normalizedInstallDir)) {
  [void]$entries.Add($normalizedInstallDir)
}

[Environment]::SetEnvironmentVariable('Path', ($entries -join ';'), 'User')
Broadcast-EnvironmentChange
