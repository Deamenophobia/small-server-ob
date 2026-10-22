$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Install Node.js 22 or newer to run Lookout.' }
Write-Host 'Open http://127.0.0.1:4310 in your browser. Press Ctrl+C here to stop.'
node server.mjs
