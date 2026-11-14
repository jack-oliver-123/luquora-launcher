Add-Type -AssemblyName System.Drawing
$iconDirectory = Join-Path $PSScriptRoot '..\build'
$bitmap = New-Object System.Drawing.Bitmap 256,256
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.Clear([System.Drawing.Color]::FromArgb(236,236,241))
$darkBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(41,41,45))
$lightBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(104,104,114))
$graphics.FillPolygon($darkBrush, [System.Drawing.Point[]]@((New-Object System.Drawing.Point 76,60),(New-Object System.Drawing.Point 115,60),(New-Object System.Drawing.Point 115,164),(New-Object System.Drawing.Point 186,164),(New-Object System.Drawing.Point 167,198),(New-Object System.Drawing.Point 76,198)))
$graphics.FillPolygon($lightBrush, [System.Drawing.Point[]]@((New-Object System.Drawing.Point 76,198),(New-Object System.Drawing.Point 115,164),(New-Object System.Drawing.Point 186,164),(New-Object System.Drawing.Point 167,198)))
$pngStream = New-Object System.IO.MemoryStream
$bitmap.Save($pngStream, [System.Drawing.Imaging.ImageFormat]::Png)
$pngBytes = $pngStream.ToArray()
[System.IO.File]::WriteAllBytes((Join-Path $iconDirectory 'icon.png'), $pngBytes)
$iconStream = New-Object System.IO.MemoryStream
$writer = New-Object System.IO.BinaryWriter $iconStream
$writer.Write([uint16]0)
$writer.Write([uint16]1)
$writer.Write([uint16]1)
$writer.Write([byte]0)
$writer.Write([byte]0)
$writer.Write([byte]0)
$writer.Write([byte]0)
$writer.Write([uint16]1)
$writer.Write([uint16]32)
$writer.Write([uint32]$pngBytes.Length)
$writer.Write([uint32]22)
$writer.Write($pngBytes)
$writer.Flush()
[System.IO.File]::WriteAllBytes((Join-Path $iconDirectory 'icon.ico'), $iconStream.ToArray())
$writer.Dispose()
$iconStream.Dispose()
$pngStream.Dispose()
$graphics.Dispose()
$bitmap.Dispose()
$darkBrush.Dispose()
$lightBrush.Dispose()
