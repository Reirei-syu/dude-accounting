$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$releaseRoot = 'D:\coding\completed\dude-app\win-unpacked'

$runningProcesses = Get-Process -Name 'dude-app' -ErrorAction SilentlyContinue
foreach ($process in $runningProcesses) {
  try {
    Stop-Process -Id $process.Id -Force -ErrorAction Stop
  } catch {
    Write-Host "Skip stopping process $($process.Id): $($_.Exception.Message)"
  }
}

Start-Sleep -Milliseconds 500

if (Test-Path $releaseRoot) {
  Remove-Item -LiteralPath $releaseRoot -Recurse -Force
}
