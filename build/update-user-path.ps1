param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('Add', 'Remove')]
  [string]$Action,

  [Parameter(Mandatory = $true)]
  [string]$TargetPath
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Resolve-NormalizedPath {
  param(
    [Parameter(Mandatory = $true)]
    [string]$PathValue
  )

  $trimmed = $PathValue.Trim()
  if ([string]::IsNullOrWhiteSpace($trimmed)) {
    return ''
  }

  try {
    return [System.IO.Path]::GetFullPath($trimmed).TrimEnd('\')
  } catch {
    return $trimmed.TrimEnd('\')
  }
}

$normalizedTarget = Resolve-NormalizedPath -PathValue $TargetPath
$currentPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$entries = New-Object 'System.Collections.Generic.List[string]'
$seen = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)

if (-not [string]::IsNullOrWhiteSpace($currentPath)) {
  foreach ($item in ($currentPath -split ';')) {
    $normalizedEntry = Resolve-NormalizedPath -PathValue $item
    if ([string]::IsNullOrWhiteSpace($normalizedEntry)) {
      continue
    }

    if ([string]::Equals($normalizedEntry, $normalizedTarget, [System.StringComparison]::OrdinalIgnoreCase)) {
      continue
    }

    if ($seen.Add($normalizedEntry)) {
      [void]$entries.Add($normalizedEntry)
    }
  }
}

if ($Action -eq 'Add' -and $seen.Add($normalizedTarget)) {
  [void]$entries.Add($normalizedTarget)
}

[Environment]::SetEnvironmentVariable('Path', ($entries -join ';'), 'User')
