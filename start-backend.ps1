$ErrorActionPreference = 'Stop'
$tripflowRoot = $PSScriptRoot
$tripflowPython = Join-Path $tripflowRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $tripflowPython)) { $tripflowPython = 'python' }
& $tripflowPython (Join-Path $tripflowRoot 'apps\api\serve.py')
exit $LASTEXITCODE
