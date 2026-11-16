param([string]$OtoolsRoot = $env:OTOOLS_ROOT)
$ErrorActionPreference = "Stop"
if (-not $OtoolsRoot) { throw "Specify -OtoolsRoot or OTOOLS_ROOT." }
$pluginRoot = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content (Join-Path $pluginRoot "plugin.json") -Raw -Encoding UTF8 | ConvertFrom-Json
if (-not $manifest.packid) { throw "Missing plugin packid." }
if (-not (Test-Path (Join-Path $OtoolsRoot "vendor/otools-plugin-sdk"))) { throw "OTools SDK not found in target repository." }
if (-not (Test-Path (Join-Path $pluginRoot "dist/index.html"))) { throw "Build dist first." }
$target = Join-Path $OtoolsRoot ("plugins/" + $manifest.packid)
New-Item -ItemType Directory -Force -Path $target | Out-Null
Copy-Item -LiteralPath (Join-Path $pluginRoot "logo.svg") -Destination $target -Force
Copy-Item -LiteralPath (Join-Path $pluginRoot "dist") -Destination $target -Recurse -Force
$manifest.PSObject.Properties.Remove("devUrl")
$manifest.PSObject.Properties.Remove("quickDev")
$json = $manifest | ConvertTo-Json -Depth 12
[System.IO.File]::WriteAllText((Join-Path $target "plugin.json"), $json + "`n", (New-Object System.Text.UTF8Encoding($false)))
Write-Host ("Deployed production plugin to " + $target)
