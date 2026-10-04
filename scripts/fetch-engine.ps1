[CmdletBinding()]
param([string]$Destination = 'engines\pikafish')
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'file-hash.ps1')
$projectRoot = Split-Path $PSScriptRoot -Parent
if (-not [IO.Path]::IsPathRooted($Destination)) { $Destination = Join-Path $projectRoot $Destination }
$Destination = [IO.Path]::GetFullPath($Destination)
$manifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'engine-source.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$cache = Join-Path $projectRoot '.cache\engine-fetch'
New-Item -ItemType Directory -Path $cache -Force | Out-Null
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
function Get-VerifiedFile($url, $file, $expectedHash) {
    if (-not (Test-Path -LiteralPath $file)) {
        Invoke-WebRequest -Uri $url -OutFile $file -UseBasicParsing -TimeoutSec 300
    }
    if ((Get-Sha256 $file) -ne $expectedHash) {
        throw "SHA256 mismatch: $file. No engine was installed."
    }
}
$archive = Join-Path $cache 'Pikafish.2026-09-06.7z'
Get-VerifiedFile $manifest.archive.url $archive $manifest.archive.sha256
Get-VerifiedFile $manifest.source.url (Join-Path $cache 'Pikafish-source-2026-09-06.zip') $manifest.source.sha256
foreach ($file in $manifest.files) {
    $existing = Join-Path $Destination $file.name
    if ((Test-Path -LiteralPath $existing) -and
        (Get-Sha256 $existing) -ne $file.sha256) {
        throw "A different file already exists: $existing. Choose an empty destination to preserve it."
    }
}
$extract = Join-Path $cache ('extract-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $extract -Force | Out-Null
$names = @($manifest.files | ForEach-Object { $_.archiveName })
& tar.exe -xf $archive -C $extract @names
if ($LASTEXITCODE -ne 0) { throw 'Could not extract the official 7z archive. Update Windows tar (bsdtar) with 7z support.' }
foreach ($file in $manifest.files) {
    if ((Get-Sha256 (Join-Path $extract $file.archiveName)) -ne $file.sha256) {
        throw "Invalid extracted file: $($file.archiveName)"
    }
}
New-Item -ItemType Directory -Path $Destination -Force | Out-Null
foreach ($file in $manifest.files) {
    Copy-Item -LiteralPath (Join-Path $extract $file.archiveName) -Destination (Join-Path $Destination $file.name) -Force
}
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'engine-source.json') -Destination $Destination -Force
Write-Host "Prepared official Pikafish 2026-09-06 Windows x64 engine: $Destination"
