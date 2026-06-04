$folder = 'C:\Users\kindj\OneDrive\Documents\MRR Production'
$prefix = 'http://localhost:5501/'
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($prefix)
$listener.Start()
Write-Output "Serving $folder at $prefix"

function Get-ContentType($path) {
    switch ([System.IO.Path]::GetExtension($path).ToLower()) {
        '.html' { return 'text/html' }
        '.htm'  { return 'text/html' }
        '.js'   { return 'application/javascript' }
        '.css'  { return 'text/css' }
        '.json' { return 'application/json' }
        '.png'  { return 'image/png' }
        '.jpg'  { return 'image/jpeg' }
        '.jpeg' { return 'image/jpeg' }
        '.gif'  { return 'image/gif' }
        '.svg'  { return 'image/svg+xml' }
        '.ico'  { return 'image/x-icon' }
        default { return 'application/octet-stream' }
    }
}

while ($listener.IsListening) {
    try {
        $ctx = $listener.GetContext()
    } catch {
        break
    }
    $req = $ctx.Request
    $path = $req.Url.AbsolutePath.TrimStart('/')
    if ([string]::IsNullOrEmpty($path)) { $path = 'index.html' }
    $file = Join-Path $folder $path
    if (Test-Path $file) {
        try {
            $bytes = [System.IO.File]::ReadAllBytes($file)
            $ctx.Response.ContentLength64 = $bytes.Length
            $ctx.Response.ContentType = Get-ContentType($file)
            $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
        } catch {
            $ctx.Response.StatusCode = 500
            $msg = "Error reading file"
            $b = [System.Text.Encoding]::UTF8.GetBytes($msg)
            $ctx.Response.OutputStream.Write($b, 0, $b.Length)
        }
    } else {
        $ctx.Response.StatusCode = 404
        $msg = "Not found"
        $b = [System.Text.Encoding]::UTF8.GetBytes($msg)
        $ctx.Response.OutputStream.Write($b, 0, $b.Length)
    }
    $ctx.Response.OutputStream.Close()
}

$listener.Stop()
$listener.Close()
