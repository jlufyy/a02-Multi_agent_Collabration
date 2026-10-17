param(
    [switch]$Dev,
    [switch]$SkipBuild,
    [int]$Port = 8010
)
$ErrorActionPreference = 'Stop'
$tripflowRoot = $PSScriptRoot
$tripflowPython = Join-Path $tripflowRoot '.venv\Scripts\python.exe'
$tripflowWeb = Join-Path $tripflowRoot 'tripflow-frontend\tripflow'
if (-not (Test-Path -LiteralPath $tripflowPython)) {
    throw 'Python environment missing. Follow README.md to install .venv first.'
}
$tripflowProbe = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
try { $tripflowProbe.Start() }
catch { throw "Port $Port is in use. Choose -Port <free port> or stop the process you started." }
finally { $tripflowProbe.Stop() }
Push-Location $tripflowRoot
$tripflowOldPort = $env:PORT
$tripflowOldProxy = $env:TRIPFLOW_API_PROXY
$tripflowApiProcess = $null
try {
    $env:PORT = "$Port"
    if (-not (Test-Path -LiteralPath (Join-Path $tripflowWeb 'node_modules'))) {
        & npm.cmd --prefix $tripflowWeb ci --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw 'Frontend dependency installation failed.' }
    }
    if ($Dev) {
        $env:TRIPFLOW_API_PROXY = "http://127.0.0.1:$Port"
        $tripflowApiProcess = Start-Process -FilePath $tripflowPython -ArgumentList 'apps/api/serve.py' -WorkingDirectory $tripflowRoot -WindowStyle Hidden -PassThru
        Write-Host 'TripFlow development: http://127.0.0.1:5173 (Ctrl+C to stop)'
        & npm.cmd --prefix $tripflowWeb -w '@tripflow/web' run dev -- --host 127.0.0.1 --port 5173 --strictPort
    } else {
        if (-not $SkipBuild) {
            & npm.cmd --prefix $tripflowWeb run build
            if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
        }
        if (-not (Test-Path -LiteralPath (Join-Path $tripflowWeb 'apps/web/dist/index.html'))) {
            throw 'Frontend build missing. Run without -SkipBuild.'
        }
        Write-Host "TripFlow: http://127.0.0.1:$Port (Ctrl+C to stop)"
        & $tripflowPython apps/api/serve.py
    }
    if ($LASTEXITCODE -ne 0) { throw "TripFlow exited with code $LASTEXITCODE" }
} finally {
    if ($tripflowApiProcess -and -not $tripflowApiProcess.HasExited) { Stop-Process -Id $tripflowApiProcess.Id -ErrorAction SilentlyContinue }
    $env:PORT = $tripflowOldPort
    $env:TRIPFLOW_API_PROXY = $tripflowOldProxy
    Pop-Location
}
