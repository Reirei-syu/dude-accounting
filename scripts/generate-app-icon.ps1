$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

Add-Type -AssemblyName System.Drawing

$repoRoot = Split-Path -Parent $PSScriptRoot
$buildDir = Join-Path $repoRoot 'build'
$resourcesDir = Join-Path $repoRoot 'resources'
$tempDir = Join-Path $repoRoot '.tmp\icon-gen'
$sourcePng = Join-Path $buildDir 'icon-source.png'
$masterPng = Join-Path $tempDir 'icon-master.png'
$buildPng = Join-Path $buildDir 'icon.png'
$resourcesPng = Join-Path $resourcesDir 'icon.png'
$icoPath = Join-Path $buildDir 'icon.ico'
$icnsPath = Join-Path $buildDir 'icon.icns'

if (-not (Test-Path -LiteralPath $sourcePng)) {
  throw "Icon source not found: $sourcePng"
}

New-Item -ItemType Directory -Force -Path $tempDir | Out-Null

function Save-Png {
  param(
    [System.Drawing.Bitmap]$Bitmap,
    [string]$Path
  )

  $encoder = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() |
    Where-Object { $_.MimeType -eq 'image/png' } |
    Select-Object -First 1
  $parameters = [System.Drawing.Imaging.EncoderParameters]::new(1)
  $parameters.Param[0] = [System.Drawing.Imaging.EncoderParameter]::new(
    [System.Drawing.Imaging.Encoder]::ColorDepth,
    32L
  )
  $Bitmap.Save($Path, $encoder, $parameters)
  $parameters.Dispose()
}

function Convert-ToSquarePng {
  param(
    [string]$InputPath,
    [string]$OutputPath,
    [int]$Size
  )

  $source = [System.Drawing.Image]::FromFile($InputPath)
  try {
    $bitmap = [System.Drawing.Bitmap]::new($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
      $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $graphics.Clear([System.Drawing.Color]::Transparent)

      $scale = [Math]::Min($Size / $source.Width, $Size / $source.Height)
      $width = [int][Math]::Round($source.Width * $scale)
      $height = [int][Math]::Round($source.Height * $scale)
      $x = [int][Math]::Round(($Size - $width) / 2)
      $y = [int][Math]::Round(($Size - $height) / 2)
      $graphics.DrawImage($source, $x, $y, $width, $height)
      Save-Png -Bitmap $bitmap -Path $OutputPath
    }
    finally {
      $graphics.Dispose()
      $bitmap.Dispose()
    }
  }
  finally {
    $source.Dispose()
  }
}

function Write-BigEndianUInt32 {
  param(
    [System.IO.Stream]$Stream,
    [UInt32]$Value
  )

  $bytes = [BitConverter]::GetBytes($Value)
  if ([BitConverter]::IsLittleEndian) {
    [Array]::Reverse($bytes)
  }
  $Stream.Write($bytes, 0, $bytes.Length)
}

function Write-Ascii {
  param(
    [System.IO.Stream]$Stream,
    [string]$Value
  )

  $bytes = [System.Text.Encoding]::ASCII.GetBytes($Value)
  $Stream.Write($bytes, 0, $bytes.Length)
}

function New-IcnsFromPng {
  param(
    [string]$PngPath,
    [string]$OutputPath
  )

  $entries = @(
    @{ Type = 'icp4'; Size = 16 },
    @{ Type = 'ic11'; Size = 32 },
    @{ Type = 'icp5'; Size = 32 },
    @{ Type = 'ic12'; Size = 64 },
    @{ Type = 'icp6'; Size = 64 },
    @{ Type = 'ic07'; Size = 128 },
    @{ Type = 'ic13'; Size = 256 },
    @{ Type = 'ic08'; Size = 256 },
    @{ Type = 'ic14'; Size = 512 },
    @{ Type = 'ic09'; Size = 512 },
    @{ Type = 'ic10'; Size = 1024 }
  ) | ForEach-Object {
    $entryPng = Join-Path $tempDir "icon-$($_.Type).png"
    Convert-ToSquarePng -InputPath $PngPath -OutputPath $entryPng -Size $_.Size
    @{
      Type = $_.Type
      Bytes = [System.IO.File]::ReadAllBytes($entryPng)
    }
  }

  $totalLength = [UInt32]8
  foreach ($entry in $entries) {
    $totalLength += [UInt32](8 + $entry.Bytes.Length)
  }

  $stream = [System.IO.File]::Open($OutputPath, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write)
  try {
    Write-Ascii -Stream $stream -Value 'icns'
    Write-BigEndianUInt32 -Stream $stream -Value $totalLength
    foreach ($entry in $entries) {
      $entryLength = [UInt32](8 + $entry.Bytes.Length)
      Write-Ascii -Stream $stream -Value $entry.Type
      Write-BigEndianUInt32 -Stream $stream -Value $entryLength
      $stream.Write($entry.Bytes, 0, $entry.Bytes.Length)
    }
  }
  finally {
    $stream.Dispose()
  }
}

Convert-ToSquarePng -InputPath $sourcePng -OutputPath $masterPng -Size 1024
Copy-Item -LiteralPath $masterPng -Destination $buildPng -Force
Copy-Item -LiteralPath $masterPng -Destination $resourcesPng -Force

node --input-type=module -e "import fs from 'node:fs'; import pngToIco from 'png-to-ico'; const ico = await pngToIco(process.argv[1]); fs.writeFileSync(process.argv[2], ico);" $masterPng $icoPath
if ($LASTEXITCODE -ne 0) {
  throw 'Failed to convert PNG icon to ICO.'
}

New-IcnsFromPng -PngPath $masterPng -OutputPath $icnsPath

Write-Host 'Generated icon assets:'
Write-Host " - $sourcePng"
Write-Host " - $masterPng"
Write-Host " - $buildPng"
Write-Host " - $resourcesPng"
Write-Host " - $icoPath"
Write-Host " - $icnsPath"
