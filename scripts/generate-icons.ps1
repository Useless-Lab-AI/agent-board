Add-Type -AssemblyName System.Drawing

function New-RoundPen([System.Drawing.Color]$c, [float]$w) {
    $pen = New-Object System.Drawing.Pen($c, [Math]::Max(1.5, $w))
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
    return $pen
}

function Draw-ShadowedPath([System.Drawing.Graphics]$g, [System.Drawing.Drawing2D.GraphicsPath]$path, [System.Drawing.Color]$fgColor, [float]$width, [float]$s) {
    $haloPen = New-RoundPen ([System.Drawing.Color]::FromArgb(150, 12, 12, 14)) ($width + (12.0 * $s))
    $g.DrawPath($haloPen, $path)
    $haloPen.Dispose()

    $fgPen = New-RoundPen $fgColor $width
    $g.DrawPath($fgPen, $path)
    $fgPen.Dispose()
}

function Draw-ShadowedLine([System.Drawing.Graphics]$g, [float]$x1, [float]$y1, [float]$x2, [float]$y2, [System.Drawing.Color]$fgColor, [float]$width, [float]$s) {
    $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    $p.AddLine($x1, $y1, $x2, $y2)
    Draw-ShadowedPath $g $p $fgColor $width $s
    $p.Dispose()
}

function Draw-ShadowedBezier([System.Drawing.Graphics]$g, [float]$x1, [float]$y1, [float]$cx1, [float]$cy1, [float]$cx2, [float]$cy2, [float]$x2, [float]$y2, [System.Drawing.Color]$fgColor, [float]$width, [float]$s) {
    $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    $p.AddBezier($x1, $y1, $cx1, $cy1, $cx2, $cy2, $x2, $y2)
    Draw-ShadowedPath $g $p $fgColor $width $s
    $p.Dispose()
}

function Draw-AgentBoardIcon([int]$size) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    # 100% Transparent Background (Tailscale style)
    $g.Clear([System.Drawing.Color]::Transparent)

    $s = $size / 512.0
    $cWhite = [System.Drawing.Color]::FromArgb(255, 255, 255, 255)
    $cGray  = [System.Drawing.Color]::FromArgb(230, 148, 146, 144)

    $subW = 32.0 * $s

    # 1. Handle Arc (Tailscale Gray)
    $hPath = New-Object System.Drawing.Drawing2D.GraphicsPath
    $hPath.AddArc((334 * $s), (224 * $s), (108 * $s), (116 * $s), -70, 140)
    Draw-ShadowedPath $g $hPath $cGray $subW $s
    $hPath.Dispose()

    # 2. Solid Pure-White Cup Bowl with subtle dark outer shadow
    $cupPath = New-Object System.Drawing.Drawing2D.GraphicsPath
    $cupPath.StartFigure()
    $cupPath.AddArc((92 * $s), (196 * $s), (36 * $s), (36 * $s), 180, 90)
    $cupPath.AddArc((332 * $s), (196 * $s), (36 * $s), (36 * $s), 270, 90)
    $cupPath.AddBezier((368 * $s), (214 * $s), (368 * $s), (368 * $s), (312 * $s), (414 * $s), (230 * $s), (414 * $s))
    $cupPath.AddBezier((230 * $s), (414 * $s), (148 * $s), (414 * $s), (92 * $s), (368 * $s), (92 * $s), (214 * $s))
    $cupPath.CloseFigure()

    $haloPen = New-RoundPen ([System.Drawing.Color]::FromArgb(145, 12, 12, 14)) (14.0 * $s)
    $g.DrawPath($haloPen, $cupPath)
    $haloPen.Dispose()

    $wBrush = New-Object System.Drawing.SolidBrush($cWhite)
    $g.FillPath($wBrush, $cupPath)
    $wBrush.Dispose()
    $cupPath.Dispose()

    # 3. Twin Steam Lines (Left = Pure White, Right = Tailscale Gray)
    Draw-ShadowedBezier $g (196 * $s) (152 * $s) (150 * $s) (100 * $s) (252 * $s) (72 * $s) (206 * $s) (24 * $s) $cWhite (30.0 * $s) $s
    Draw-ShadowedBezier $g (272 * $s) (152 * $s) (236 * $s) (110 * $s) (316 * $s) (84 * $s) (280 * $s) (42 * $s) $cGray  (26.0 * $s) $s

    # 4. Saucer Base Line (Tailscale Gray)
    Draw-ShadowedLine $g (114 * $s) (468 * $s) (346 * $s) (468 * $s) $cGray $subW $s

    $g.Dispose()
    return $bmp
}

function ConvertTo-IcoFrameBytes([System.Drawing.Bitmap]$bmp) {
    $w = $bmp.Width
    $h = $bmp.Height

    if ($w -ge 256) {
        $pms = New-Object System.IO.MemoryStream
        $bmp.Save($pms, [System.Drawing.Imaging.ImageFormat]::Png)
        [byte[]]$pngBytes = $pms.ToArray()
        $pms.Dispose()
        return , $pngBytes
    }

    $maskStride = [int]([Math]::Floor(($w + 31) / 32)) * 4
    $xorSize = $w * $h * 4
    $andSize = $maskStride * $h

    $ms = New-Object System.IO.MemoryStream
    $bw = New-Object System.IO.BinaryWriter($ms)

    $bw.Write([uint32]40)
    $bw.Write([int32]$w)
    $bw.Write([int32]($h * 2))
    $bw.Write([uint16]1)
    $bw.Write([uint16]32)
    $bw.Write([uint32]0)
    $bw.Write([uint32]($xorSize + $andSize))
    $bw.Write([int32]0)
    $bw.Write([int32]0)
    $bw.Write([uint32]0)
    $bw.Write([uint32]0)

    $rect = New-Object System.Drawing.Rectangle(0, 0, $w, $h)
    $data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $rawBytes = New-Object byte[] ($w * $h * 4)
    [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $rawBytes, 0, $rawBytes.Length)
    $bmp.UnlockBits($data)

    $rowByteLen = $w * 4
    for ($y = $h - 1; $y -ge 0; $y--) {
        $bw.Write($rawBytes, $y * $rowByteLen, $rowByteLen)
    }

    for ($y = $h - 1; $y -ge 0; $y--) {
        $rowMask = New-Object byte[] $maskStride
        $rowOffset = $y * $rowByteLen
        for ($x = 0; $x -lt $w; $x++) {
            $alpha = $rawBytes[$rowOffset + ($x * 4) + 3]
            if ($alpha -eq 0) {
                $byteIdx = [int]([Math]::Floor($x / 8))
                $bitIdx = 7 - ($x % 8)
                $rowMask[$byteIdx] = [byte]($rowMask[$byteIdx] -bor (1 -shl $bitIdx))
            }
        }
        $bw.Write($rowMask, 0, $rowMask.Length)
    }

    $bw.Flush()
    [byte[]]$outBytes = $ms.ToArray()
    $bw.Close()
    $ms.Dispose()
    return , $outBytes
}

function Write-MultiSizeIco([string]$outPath, [int[]]$sizes) {
    $frames = @()
    foreach ($sz in $sizes) {
        $b = Draw-AgentBoardIcon $sz
        [byte[]]$frameBytes = ConvertTo-IcoFrameBytes $b
        $b.Dispose()
        $frames += @{ Size = $sz; Bytes = $frameBytes }
    }

    $fs = [System.IO.File]::Open($outPath, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write)
    $bw = New-Object System.IO.BinaryWriter($fs)

    $bw.Write([uint16]0)
    $bw.Write([uint16]1)
    $bw.Write([uint16]$frames.Count)

    $offset = 6 + ($frames.Count * 16)
    foreach ($f in $frames) {
        [byte[]]$fb = $f.Bytes
        $dim = if ($f.Size -ge 256) { [byte]0 } else { [byte]$f.Size }
        $bw.Write([byte]$dim)
        $bw.Write([byte]$dim)
        $bw.Write([byte]0)
        $bw.Write([byte]0)
        $bw.Write([uint16]1)
        $bw.Write([uint16]32)
        $bw.Write([uint32]$fb.Length)
        $bw.Write([uint32]$offset)
        $offset += $fb.Length
    }

    $bw.Flush()
    foreach ($f in $frames) {
        [byte[]]$fb = $f.Bytes
        $fs.Write($fb, 0, $fb.Length)
    }

    $fs.Flush()
    $bw.Close()
    $fs.Close()
}

New-Item -ItemType Directory -Force -Path build, assets | Out-Null

# 1. 512x512 Master PNG
$icon512 = Draw-AgentBoardIcon 512
$icon512.Save("build/icon.png", [System.Drawing.Imaging.ImageFormat]::Png)
$icon512.Save("assets/icon.png", [System.Drawing.Imaging.ImageFormat]::Png)
$icon512.Dispose()

# 2. 64x64 tray@2x
$tray64 = Draw-AgentBoardIcon 64
$tray64.Save("assets/tray@2x.png", [System.Drawing.Imaging.ImageFormat]::Png)
$tray64.Dispose()

# 3. 32x32 tray
$tray32 = Draw-AgentBoardIcon 32
$tray32.Save("assets/tray.png", [System.Drawing.Imaging.ImageFormat]::Png)
$tray32.Save("build/tray.png", [System.Drawing.Imaging.ImageFormat]::Png)
$tray32.Dispose()

# 4. Multi-resolution 32-bit BGRA DIB + 256 PNG ICO (16, 24, 32, 48, 64, 128, 256)
Write-MultiSizeIco "build/icon.ico" @(16, 24, 32, 48, 64, 128, 256)
Copy-Item "build/icon.ico" "assets/icon.ico" -Force

Write-Host "All Option T3 (Tailscale-Style Transparent Solid White Coffee Cup) icons generated successfully!"
