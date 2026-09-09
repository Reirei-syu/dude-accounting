$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$outputRoot = [IO.Path]::GetFullPath('D:\coding\completed\dude-app')
$ancestor = $outputRoot
while ($ancestor) {
  if (Test-Path -LiteralPath $ancestor) {
    $ancestorItem = Get-Item -LiteralPath $ancestor -Force
    if (-not $ancestorItem.PSIsContainer -or ($ancestorItem.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
      throw "产物目录祖先不是普通目录，停止操作：$ancestor"
    }
  }
  $ancestor = [IO.Path]::GetDirectoryName($ancestor)
}
$releaseRoot = [IO.Path]::GetFullPath((Join-Path $outputRoot 'win-unpacked'))
if ([IO.Path]::GetDirectoryName($releaseRoot) -ne $outputRoot) {
  throw '发布目录不在指定产物目录内，停止操作。'
}

$runningProcesses = Get-Process -Name 'dude-app' -ErrorAction SilentlyContinue
foreach ($process in $runningProcesses) {
  try { $executable = $process.Path } catch { throw '无法确认同名应用路径，停止准备产物。' }
  if (-not $executable) { throw '无法确认同名应用路径，停止准备产物。' }
  if ([IO.Path]::GetFullPath($executable).StartsWith($releaseRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw "目标产物正在运行（PID $($process.Id)），请退出该隔离测试应用后重试。"
  }
}

if (Test-Path -LiteralPath $releaseRoot) {
  $item = Get-Item -LiteralPath $releaseRoot
  if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw '产物目录是链接，拒绝移动。' }
  $backupRoot = [IO.Path]::GetFullPath((Join-Path $outputRoot ('previous-unpacked-' + [Guid]::NewGuid().ToString('N'))))
  if ([IO.Path]::GetDirectoryName($backupRoot) -ne $outputRoot) { throw '备份目录越界。' }
  Move-Item -LiteralPath $releaseRoot -Destination $backupRoot
  Write-Host "已保留旧 unpacked 产物：$backupRoot"
}
