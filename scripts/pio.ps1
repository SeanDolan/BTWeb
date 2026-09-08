param([Parameter(ValueFromRemainingArguments = $true)][string[]]$PioArgs)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$env:PYTHONPATH = Join-Path $projectRoot '.tools/python-deps'
# All tool-managed writes are kept inside this project, including temporary files.
$env:PLATFORMIO_CORE_DIR = Join-Path $projectRoot '.pio-core'
$env:PLATFORMIO_CACHE_DIR = Join-Path $projectRoot '.cache/platformio'
$env:PLATFORMIO_SETTING_ENABLE_TELEMETRY = 'No'
$env:PLATFORMIO_SETTING_CHECK_PLATFORMIO_INTERVAL = '0'
$env:PLATFORMIO_SETTING_CHECK_PLATFORMS_INTERVAL = '0'
$env:PLATFORMIO_SETTING_CHECK_LIBRARIES_INTERVAL = '0'
$env:PYTHONDONTWRITEBYTECODE = '1'
$env:PIP_CACHE_DIR = Join-Path $projectRoot '.cache/pip'
$env:PYTHONUSERBASE = Join-Path $projectRoot '.tools/python-user'
$env:TEMP = Join-Path $projectRoot '.tmp'
$env:TMP = $env:TEMP
New-Item -ItemType Directory -Force -Path $env:TEMP | Out-Null
$pioCommand = Get-Command pio -ErrorAction SilentlyContinue
$existingPio = Join-Path $env:USERPROFILE '.platformio/penv/Scripts/platformio.exe'
if ($pioCommand) { & $pioCommand.Source @PioArgs }
elseif (Test-Path -LiteralPath $existingPio) { & $existingPio @PioArgs }
else { throw 'Install PlatformIO or put its existing executable on PATH, then rerun.' }
exit $LASTEXITCODE
