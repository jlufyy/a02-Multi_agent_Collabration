param(
    [ValidateSet('Debug', 'Release')][string]$Variant = 'Release',
    [string]$EnvFile,
    [string]$Python,
    [string]$GradleHome = 'D:\Gradle\ConnectPad'
)
$ErrorActionPreference = 'Stop'
$tripflowRoot = Split-Path $PSScriptRoot -Parent
if (-not $Python) {
    $Python = Join-Path $tripflowRoot '.venv\Scripts\python.exe'
    if (-not (Test-Path -LiteralPath $Python)) { $Python = (Get-Command python).Source }
}
if (-not $EnvFile) { $EnvFile = Join-Path $tripflowRoot '.env' }
$tripflowPriorCache = $env:GRADLE_USER_HOME
Push-Location $tripflowRoot
try {
    if (-not (Test-Path node_modules)) {
        & npm.cmd ci --no-audit --no-fund
        if ($LASTEXITCODE) { throw 'Root npm dependencies failed.' }
    }
    if (-not (Test-Path tripflow-frontend/tripflow/node_modules)) {
        & npm.cmd --prefix tripflow-frontend/tripflow ci --no-audit --no-fund
        if ($LASTEXITCODE) { throw 'Frontend npm dependencies failed.' }
    }
    & npm.cmd run build
    if ($LASTEXITCODE) { throw 'Frontend build failed.' }
    & $Python android/scripts/prepare.py --env $EnvFile
    if ($LASTEXITCODE) { throw 'Personal assets preparation failed.' }
    $env:GRADLE_USER_HOME = $GradleHome
    Push-Location android
    try {
        & .\gradlew.bat "test${Variant}UnitTest" "lint${Variant}" "assemble${Variant}" "-PtripflowPython=$Python" --console=plain
        if ($LASTEXITCODE) { throw 'Android verification/build failed.' }
    } finally { Pop-Location }
    $tripflowApk = "android/app/build/outputs/apk/$($Variant.ToLower())/app-$($Variant.ToLower()).apk"
    $tripflowOutput = Join-Path $tripflowRoot 'output/android'
    New-Item -ItemType Directory -Force $tripflowOutput | Out-Null
    Copy-Item -LiteralPath $tripflowApk -Destination (Join-Path $tripflowOutput "TripFlow-1.0.2-personal-$($Variant.ToLower())-arm64.apk")
    Get-FileHash -Algorithm SHA256 -LiteralPath $tripflowApk
} finally {
    Pop-Location
    $env:GRADLE_USER_HOME = $tripflowPriorCache
}
