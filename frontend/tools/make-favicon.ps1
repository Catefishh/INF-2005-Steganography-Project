# Builds frontend/public/favicon.ico from the same wave as the brand mark.
# Run from the frontend directory: pwsh -File tools/make-favicon.ps1
$ErrorActionPreference = "Stop"

$size = 32
$bg = @(0x17, 0x21, 0x2c)
$teal = @(0x0f, 0xa3, 0xa3)
$coral = @(0xef, 0x5f, 0x4c)

# The two dashed wave paths, sampled: bitmaps have no curves in a 32px icon.
function Wave-Y([double]$x, [int]$phase) {
    $t = $x / 32.0
    $rad = $t * 4 * [Math]::PI + $phase
    return 16.0 - 8.5 * [Math]::Sin($rad)
}

$pixels = New-Object 'byte[]' ($size * $size * 4)

function Set-Pixel([int]$x, [int]$y, $rgb, [double]$alpha) {
    if ($x -lt 0 -or $y -lt 0 -or $x -ge $size -or $y -ge $size) { return }
    $offset = (($size - 1 - $y) * $size + $x) * 4
    $pixels[$offset] = [byte]$rgb[2]      # blue
    $pixels[$offset + 1] = [byte]$rgb[1]  # green
    $pixels[$offset + 2] = [byte]$rgb[0]  # red
    $pixels[$offset + 3] = 255
}

# Background with rounded corners.
$radius = 7.0
for ($y = 0; $y -lt $size; $y++) {
    for ($x = 0; $x -lt $size; $x++) {
        $cx = [Math]::Min([Math]::Max($x + 0.5, $radius), $size - $radius)
        $cy = [Math]::Min([Math]::Max($y + 0.5, $radius), $size - $radius)
        if ((($x + 0.5 - $cx) * ($x + 0.5 - $cx) + ($y + 0.5 - $cy) * ($y + 0.5 - $cy)) -le $radius * $radius) {
            Set-Pixel $x $y $bg 1
        }
    }
}

# Two waves, dashed so the icon reads like the animated brand rather than a solid squiggle.
foreach ($x in 0..($size - 1)) {
    $dash = [Math]::Floor($x / 3) % 2 -eq 0
    $ty = [int][Math]::Round((Wave-Y $x 0))
    $cy = [int][Math]::Round((Wave-Y $x ([Math]::PI)))
    if ($dash) { foreach ($dy in -1..1) { Set-Pixel $x ($ty + $dy) $teal 1 } }
    else { foreach ($dy in -1..1) { Set-Pixel $x ($cy + $dy) $coral 1 } }
}

$xor = New-Object 'byte[]' ($size * $size * 4)
[Array]::Copy($pixels, $xor, $pixels.Length)

$stream = New-Object System.IO.MemoryStream
$writer = New-Object System.IO.BinaryWriter($stream)

# ICONDIR + one ICONDIRENTRY, then a BITMAPINFOHEADER whose height covers the XOR mask and AND mask.
$writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]1)
$writer.Write([byte]$size); $writer.Write([byte]$size); $writer.Write([byte]0); $writer.Write([byte]0)
$writer.Write([uint16]1); $writer.Write([uint16]32)
$writer.Write([uint32](40 + $xor.Length + ($size * $size / 8)))
$writer.Write([uint32]22)
$writer.Write([int32]40); $writer.Write([int32]$size); $writer.Write([int32]($size * 2))
$writer.Write([uint16]1); $writer.Write([uint16]32); $writer.Write([uint32]0)
$writer.Write([uint32]$xor.Length); $writer.Write([int32]0); $writer.Write([int32]0)
$writer.Write([uint32]0); $writer.Write([uint32]0)
$writer.Write($xor)
# AND mask: all zero, because the alpha channel already carries the shape.
$writer.Write((New-Object 'byte[]' ($size * $size / 8)))
$writer.Flush()

$target = Join-Path $PSScriptRoot "..\public\favicon.ico"
[System.IO.File]::WriteAllBytes($target, $stream.ToArray())
$writer.Dispose()
Write-Host "Wrote $target ($($stream.Length) bytes)"
