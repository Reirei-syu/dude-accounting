$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$directories = @(
  'D:\Apps\Dude Accounting',
  'D:\DudeAccountingData\Backups',
  'D:\DudeAccountingData\Exports',
  'D:\coding\completed\dude-app'
)

foreach ($directory in $directories) {
  New-Item -ItemType Directory -Force -Path $directory | Out-Null
}

Write-Host 'Prepared local install and release directories:'
foreach ($directory in $directories) {
  Write-Host " - $directory"
}
