param([ValidateSet('open','close','update','status')][string]$Action = 'open')
$ErrorActionPreference = 'Stop'
function Get-FitaHash([string]$Path) {
  $hasher = [Security.Cryptography.SHA256]::Create()
  try { return [BitConverter]::ToString($hasher.ComputeHash([IO.File]::ReadAllBytes($Path))).Replace('-','').ToLowerInvariant() }
  finally { $hasher.Dispose() }
}
try {
  $installRoot = $PSScriptRoot
  # Check before downloads, dependency installation or launcher state changes.
  if ($Action -eq 'open' -or $Action -eq 'update') {
    $locationFile = Join-Path $installRoot 'runtime\install-location.json'
    if (Test-Path -LiteralPath $locationFile) {
      $location = Get-Content -LiteralPath $locationFile -Raw -Encoding UTF8 | ConvertFrom-Json
      if ($location.schema -ne 1 -or $location.installedRoot -isnot [string] -or $location.installedRoot -notmatch '^(?:[a-zA-Z]:[\\/]|\\\\)') {
        throw 'Invalid installation location marker. Keep your project data and restore the original installation folder.'
      }
      $originalRoot = [IO.Path]::GetFullPath($location.installedRoot).Replace('/','\').TrimEnd('\')
      $currentRoot = [IO.Path]::GetFullPath($installRoot).Replace('/','\').TrimEnd('\')
      if (-not [string]::Equals($originalRoot,$currentRoot,[StringComparison]::OrdinalIgnoreCase)) {
        throw ('This FITA installation was moved.' + [Environment]::NewLine + 'Original folder: ' + $location.installedRoot + [Environment]::NewLine + 'Current folder: ' + $installRoot + [Environment]::NewLine + 'Opening and updating are blocked. Move the entire FITA folder back to its original location to open it and export your projects. To use a different location, install a fresh copy there and import your .fita backups. Keep this folder and user-data until all projects are backed up. No files were migrated or deleted.')
      }
    }
  }
  $appRoot = $installRoot
  $pointer = Join-Path $installRoot 'active.json'
  if (Test-Path -LiteralPath $pointer) {
    $active = Get-Content -LiteralPath $pointer -Raw | ConvertFrom-Json
    if ($active.version -notmatch '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$') { throw 'Invalid installation pointer.' }
    $appRoot = Join-Path (Join-Path $installRoot 'versions') $active.version
    if (-not (Test-Path -LiteralPath (Join-Path $appRoot 'distribution\manager.mjs'))) { throw 'Active version is incomplete. Do not remove previous versions.' }
  }
  $nodeExe = $null
  $existingNode = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($existingNode -and $env:FITA_USE_BUNDLED_NODE -ne '1') {
    $detected = & $existingNode.Source -p 'Number(process.versions.node.split(String.fromCharCode(46))[0])>=24'
    if ($LASTEXITCODE -eq 0 -and $detected -eq 'true') { $nodeExe = $existingNode.Source }
  }
  $config = Get-Content -LiteralPath (Join-Path $appRoot 'distribution\config.json') -Raw | ConvertFrom-Json
  if (-not $nodeExe) {
    if ($env:PROCESSOR_ARCHITECTURE -ne 'AMD64') { throw 'This preview supports Windows x64 only. Install Node.js 24 LTS or use an x64 Windows system.' }
    $nodeRoot = Join-Path $installRoot ('runtime\node-v' + $config.nodeVersion + '-win-x64')
    $nodeExe = Join-Path $nodeRoot 'node.exe'
    if (-not (Test-Path -LiteralPath $nodeExe)) {
      if ($Action -eq 'close' -or $Action -eq 'status') { throw 'FITA has not been installed yet. Open FITA first.' }
      Write-Host 'FITA first-time setup: downloading Node.js from nodejs.org. Internet is required.'
      [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
      $runtimeRoot = Join-Path $installRoot 'runtime'
      New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null
      $archive = Join-Path $runtimeRoot ('node-' + [guid]::NewGuid().ToString('N') + '.zip')
      $url = 'https://nodejs.org/dist/v' + $config.nodeVersion + '/node-v' + $config.nodeVersion + '-win-x64.zip'
      Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $archive
      if ((Get-FitaHash $archive) -ne $config.nodeArchiveSha256) { throw 'Node.js checksum mismatch. Setup stopped.' }
      Expand-Archive -LiteralPath $archive -DestinationPath $runtimeRoot
      Remove-Item -LiteralPath $archive
    }
  }
  $env:PATH = (Split-Path -Parent $nodeExe) + ';' + $env:PATH
  $npmCli = Join-Path (Split-Path -Parent $nodeExe) 'node_modules\npm\bin\npm-cli.js'
  if (-not (Test-Path -LiteralPath $npmCli)) { throw 'The selected Node installation does not include npm. Install the official Node.js distribution.' }
  $env:FITA_NPM_CLI = $npmCli
  Push-Location $appRoot
  try {
    $lockHash = Get-FitaHash (Join-Path $appRoot 'package-lock.json')
    $receipt = 'node_modules\.fita-lock-sha256'
    $ready = (Test-Path -LiteralPath $receipt) -and ((Get-Content -LiteralPath $receipt -Raw).Trim() -eq $lockHash)
    if (-not $ready) {
      if ($Action -eq 'close' -or $Action -eq 'status') { throw 'FITA setup is incomplete. Open FITA first.' }
      Write-Host 'Installing FITA components from the locked npm dependency list. Internet is required.'
      $npmArgs = @('ci','--ignore-scripts','--no-audit','--no-fund')
      if (Test-Path -LiteralPath 'dist\index.html') { $npmArgs += '--omit=dev' }
      & $nodeExe $npmCli @npmArgs
      if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed. Open FITA again to retry setup.' }
      & $nodeExe -e "require('sharp');require('express');require('yauzl')"
      if ($LASTEXITCODE -ne 0) { throw 'Installed components could not load. Open FITA again to retry setup.' }
      Set-Content -LiteralPath $receipt -Value $lockHash -Encoding ASCII
    }
    if (-not (Test-Path -LiteralPath 'dist\index.html')) {
      Write-Host 'Building FITA from source...'
      & $nodeExe $npmCli run build
      if ($LASTEXITCODE -ne 0) { throw 'FITA build failed.' }
    }
    & $nodeExe (Join-Path $appRoot 'distribution\manager.mjs') $Action $installRoot
    if ($LASTEXITCODE -ne 0) { throw 'FITA could not complete the request. See the message above.' }
  } finally { Pop-Location }
} catch {
  Write-Host ('FITA: ' + $_.Exception.Message) -ForegroundColor Red
  exit 1
}
