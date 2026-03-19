$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

Add-Type -AssemblyName System.Drawing

$repoRoot = Split-Path -Parent $PSScriptRoot
$buildDir = Join-Path $repoRoot 'build'
$resourcesDir = Join-Path $repoRoot 'resources'
$tempDir = Join-Path $repoRoot '.tmp\icon-gen'

New-Item -ItemType Directory -Force -Path $tempDir | Out-Null

function New-RoundedRectPath {
  param(
    [float]$X,
    [float]$Y,
    [float]$Width,
    [float]$Height,
    [float]$Radius
  )

  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $diameter = $Radius * 2
  $path.AddArc($X, $Y, $diameter, $diameter, 180, 90)
  $path.AddArc($X + $Width - $diameter, $Y, $diameter, $diameter, 270, 90)
  $path.AddArc($X + $Width - $diameter, $Y + $Height - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc($X, $Y + $Height - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()
  return $path
}

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

$canvasSize = 1024
$bitmap = [System.Drawing.Bitmap]::new($canvasSize, $canvasSize)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$graphics.Clear([System.Drawing.Color]::Transparent)

$backgroundRect = [System.Drawing.RectangleF]::new(72, 72, 880, 880)
$backgroundPath = New-RoundedRectPath -X $backgroundRect.X -Y $backgroundRect.Y -Width $backgroundRect.Width -Height $backgroundRect.Height -Radius 210
$shadowPath = New-RoundedRectPath -X 92 -Y 108 -Width 840 -Height 840 -Radius 205
$shadowBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(48, 16, 74, 66))
$graphics.FillPath($shadowBrush, $shadowPath)

$gradientBrush = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
  [System.Drawing.PointF]::new(72, 72),
  [System.Drawing.PointF]::new(952, 952),
  [System.Drawing.Color]::FromArgb(255, 195, 245, 220),
  [System.Drawing.Color]::FromArgb(255, 120, 220, 208)
)
$graphics.FillPath($gradientBrush, $backgroundPath)

$sparkleBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(90, 255, 255, 255))
$graphics.FillEllipse($sparkleBrush, 176, 148, 220, 150)
$graphics.FillEllipse($sparkleBrush, 708, 208, 118, 86)
$graphics.FillEllipse($sparkleBrush, 644, 720, 164, 98)

$bookShadow = New-RoundedRectPath -X 252 -Y 286 -Width 536 -Height 444 -Radius 88
$graphics.FillPath([System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(42, 23, 54, 78)), $bookShadow)

$bookRect = [System.Drawing.RectangleF]::new(236, 262, 536, 444)
$bookPath = New-RoundedRectPath -X $bookRect.X -Y $bookRect.Y -Width $bookRect.Width -Height $bookRect.Height -Radius 88
$pageBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 250, 255, 252))
$graphics.FillPath($pageBrush, $bookPath)

$spineBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 52, 160, 156))
$graphics.FillPie($spineBrush, 202, 262, 148, 444, 90, 180)
$graphics.FillRectangle($spineBrush, 236, 262, 58, 444)

$pageFoldBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 230, 250, 244))
$pageFold = [System.Drawing.PointF[]]@(
  [System.Drawing.PointF]::new(624, 262),
  [System.Drawing.PointF]::new(772, 262),
  [System.Drawing.PointF]::new(772, 410)
)
$graphics.FillPolygon($pageFoldBrush, $pageFold)

$linePen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(255, 146, 217, 201), 20)
$linePen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$linePen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$graphics.DrawLine($linePen, 360, 380, 656, 380)
$graphics.DrawLine($linePen, 360, 460, 620, 460)
$graphics.DrawLine($linePen, 360, 540, 584, 540)

$eyeBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 44, 86, 86))
$graphics.FillEllipse($eyeBrush, 412, 504, 36, 52)
$graphics.FillEllipse($eyeBrush, 544, 504, 36, 52)
$graphics.FillEllipse([System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(220, 255, 255, 255)), 420, 514, 10, 14)
$graphics.FillEllipse([System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(220, 255, 255, 255)), 552, 514, 10, 14)

$blushBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(96, 255, 170, 178))
$graphics.FillEllipse($blushBrush, 360, 548, 66, 36)
$graphics.FillEllipse($blushBrush, 570, 548, 66, 36)

$smilePen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(255, 44, 86, 86), 12)
$smilePen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$smilePen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$graphics.DrawArc($smilePen, 446, 534, 104, 74, 15, 150)

$coinShadowBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(36, 112, 78, 0))
$graphics.FillEllipse($coinShadowBrush, 622, 612, 204, 204)
$coinBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 255, 211, 94))
$coinRingPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(255, 227, 165, 44), 18)
$graphics.FillEllipse($coinBrush, 606, 594, 204, 204)
$graphics.DrawEllipse($coinRingPen, 615, 603, 186, 186)

$accentPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(255, 180, 104, 10), 22)
$accentPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$accentPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$graphics.DrawLine($accentPen, 706, 644, 706, 742)
$graphics.DrawArc($accentPen, 660, 642, 88, 72, 210, 180)
$graphics.DrawArc($accentPen, 664, 688, 84, 72, 20, 180)

$heartBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 255, 137, 160))
$heartPath = [System.Drawing.Drawing2D.GraphicsPath]::new()
$heartPath.AddBezier(
  [System.Drawing.PointF]::new(296, 736),
  [System.Drawing.PointF]::new(262, 694),
  [System.Drawing.PointF]::new(202, 714),
  [System.Drawing.PointF]::new(220, 770)
)
$heartPath.AddBezier(
  [System.Drawing.PointF]::new(220, 770),
  [System.Drawing.PointF]::new(236, 826),
  [System.Drawing.PointF]::new(298, 838),
  [System.Drawing.PointF]::new(324, 792)
)
$heartPath.AddBezier(
  [System.Drawing.PointF]::new(324, 792),
  [System.Drawing.PointF]::new(348, 838),
  [System.Drawing.PointF]::new(412, 826),
  [System.Drawing.PointF]::new(428, 770)
)
$heartPath.AddBezier(
  [System.Drawing.PointF]::new(428, 770),
  [System.Drawing.PointF]::new(446, 714),
  [System.Drawing.PointF]::new(386, 694),
  [System.Drawing.PointF]::new(352, 736)
)
$heartPath.CloseFigure()
$graphics.FillPath($heartBrush, $heartPath)

$outlinePen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(52, 19, 69, 66), 8)
$graphics.DrawPath($outlinePen, $backgroundPath)

$masterPng = Join-Path $tempDir 'icon-master.png'
Save-Png -Bitmap $bitmap -Path $masterPng

$bitmap.Dispose()
$graphics.Dispose()
$backgroundPath.Dispose()
$shadowPath.Dispose()
$bookShadow.Dispose()
$bookPath.Dispose()
$heartPath.Dispose()
$shadowBrush.Dispose()
$gradientBrush.Dispose()
$sparkleBrush.Dispose()
$pageBrush.Dispose()
$spineBrush.Dispose()
$pageFoldBrush.Dispose()
$linePen.Dispose()
$eyeBrush.Dispose()
$blushBrush.Dispose()
$smilePen.Dispose()
$coinShadowBrush.Dispose()
$coinBrush.Dispose()
$coinRingPen.Dispose()
$accentPen.Dispose()
$heartBrush.Dispose()
$outlinePen.Dispose()

Copy-Item -Path $masterPng -Destination (Join-Path $buildDir 'icon.png') -Force
Copy-Item -Path $masterPng -Destination (Join-Path $resourcesDir 'icon.png') -Force

$icoPath = Join-Path $buildDir 'icon.ico'
node --input-type=module -e "import fs from 'node:fs'; import pngToIco from 'png-to-ico'; const ico = await pngToIco(process.argv[1]); fs.writeFileSync(process.argv[2], ico);" $masterPng $icoPath
if ($LASTEXITCODE -ne 0) {
  throw 'Failed to convert PNG icon to ICO.'
}

Write-Host "Generated icon assets:"
Write-Host " - $masterPng"
Write-Host " - $(Join-Path $buildDir 'icon.png')"
Write-Host " - $icoPath"
Write-Host " - $(Join-Path $resourcesDir 'icon.png')"
