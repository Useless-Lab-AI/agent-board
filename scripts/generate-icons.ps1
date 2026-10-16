Add-Type -AssemblyName System.Drawing

function Draw-AgentBoardIcon([int]$size) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

    # Scale factor
    $s = $size / 512.0

    # Background Rounded Rect
    $bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        (New-Object System.Drawing.PointF 0, 0),
        (New-Object System.Drawing.PointF $size, $size),
        [System.Drawing.Color]::FromArgb(255, 15, 23, 42),
        [System.Drawing.Color]::FromArgb(255, 9, 13, 22)
    )

    $rect = New-Object System.Drawing.RectangleF (24*$s), (24*$s), (464*$s), (464*$s)
    $radius = 100 * $s

    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $diameter = $radius * 2
    $arc = New-Object System.Drawing.RectangleF $rect.X, $rect.Y, $diameter, $diameter
    $path.AddArc($arc, 180, 90)
    $arc.X = $rect.Right - $diameter
    $path.AddArc($arc, 270, 90)
    $arc.Y = $rect.Bottom - $diameter
    $path.AddArc($arc, 0, 90)
    $arc.X = $rect.Left
    $path.AddArc($arc, 90, 90)
    $path.CloseFigure()

    $g.FillPath($bgBrush, $path)

    # Border
    $borderPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(200, 56, 189, 248), (4 * $s))
    $g.DrawPath($borderPen, $path)

    # Grid 4 cards
    $cardBg = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 30, 41, 59))
    $cardPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 51, 65, 85), (2 * $s))

    function Draw-Card($x, $y, $w, $h, $accentColor) {
        $cRect = New-Object System.Drawing.RectangleF ($x*$s), ($y*$s), ($w*$s), ($h*$s)
        $cRadius = 18 * $s
        $cPath = New-Object System.Drawing.Drawing2D.GraphicsPath
        $d = $cRadius * 2
        $a = New-Object System.Drawing.RectangleF $cRect.X, $cRect.Y, $d, $d
        $cPath.AddArc($a, 180, 90)
        $a.X = $cRect.Right - $d
        $cPath.AddArc($a, 270, 90)
        $a.Y = $cRect.Bottom - $d
        $cPath.AddArc($a, 0, 90)
        $a.X = $cRect.Left
        $cPath.AddArc($a, 90, 90)
        $cPath.CloseFigure()

        $g.FillPath($cardBg, $cPath)
        $g.DrawPath($cardPen, $cPath)

        # Accent Indicator
        $accBrush = New-Object System.Drawing.SolidBrush($accentColor)
        $g.FillEllipse($accBrush, ($x + 20)*$s, ($y + 20)*$s, (14*$s), (14*$s))
        $accBrush.Dispose()

        # Accent line
        $accLineBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(180, $accentColor.R, $accentColor.G, $accentColor.B))
        $g.FillRectangle($accLineBrush, ($x + 44)*$s, ($y + 23)*$s, (60*$s), (8*$s))
        $accLineBrush.Dispose()

        # Content lines
        $lineBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 100, 116, 139))
        $g.FillRectangle($lineBrush, ($x + 20)*$s, ($y + 54)*$s, ($w - 40)*$s, (6*$s))
        $g.FillRectangle($lineBrush, ($x + 20)*$s, ($y + 70)*$s, ($w - 60)*$s, (6*$s))
        $g.FillRectangle($lineBrush, ($x + 20)*$s, ($y + 86)*$s, ($w - 80)*$s, (6*$s))
        $lineBrush.Dispose()

        $cPath.Dispose()
    }

    # Card 1: Codex Blue
    Draw-Card 72 72 168 152 ([System.Drawing.Color]::FromArgb(255, 56, 189, 248))
    # Card 2: Claude Amber
    Draw-Card 272 72 168 152 ([System.Drawing.Color]::FromArgb(255, 245, 158, 11))
    # Card 3: Antigravity Indigo
    Draw-Card 72 256 168 184 ([System.Drawing.Color]::FromArgb(255, 129, 140, 248))
    # Card 4: Grid Hub Emerald
    Draw-Card 272 256 168 184 ([System.Drawing.Color]::FromArgb(255, 34, 197, 94))

    # Clean up
    $cardBg.Dispose()
    $cardPen.Dispose()
    $bgBrush.Dispose()
    $borderPen.Dispose()
    $path.Dispose()
    $g.Dispose()

    return $bmp
}

# Ensure directories
New-Item -ItemType Directory -Force -Path build, assets | Out-Null

# 1. 512x512
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

# 4. Generate build/icon.ico for Windows
# Windows icon format can embed the PNG
$iconBmp = Draw-AgentBoardIcon 256
$hIcon = $iconBmp.GetHicon()
$icon = [System.Drawing.Icon]::FromHandle($hIcon)
$fs = [System.IO.File]::OpenWrite("build/icon.ico")
$icon.Save($fs)
$fs.Close()
$icon.Dispose()
$iconBmp.Dispose()

Remove-Item assets/test.png -ErrorAction SilentlyContinue
Write-Host "All icons generated successfully!"
