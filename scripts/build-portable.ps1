[CmdletBinding()]
param([string]$RuntimeDirectory = '')
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'file-hash.ps1')
$projectRoot = Split-Path $PSScriptRoot -Parent
$package = Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$name = "wilderness-xiangqi-$($package.version)-windows-x64"
$stageParent = Join-Path $projectRoot ('.cache\package-' + [Guid]::NewGuid().ToString('N'))
$stage = Join-Path $stageParent $name
$dist = Join-Path $projectRoot 'dist'
$zipPath = Join-Path $dist "$name.zip"
if (Test-Path -LiteralPath $zipPath) { throw "Output already exists: $zipPath. Rename it before rebuilding." }
$runtime = if ($RuntimeDirectory) { [IO.Path]::GetFullPath($RuntimeDirectory) } else { Join-Path $projectRoot 'node_modules\electron\dist' }
if (-not (Test-Path -LiteralPath (Join-Path $runtime 'electron.exe'))) { throw 'Run npm ci first (or supply -RuntimeDirectory).' }
$actualVersion = (Get-Content -LiteralPath (Join-Path $runtime 'version') -Raw).Trim()
if ($actualVersion -ne $package.devDependencies.electron) { throw "Electron version mismatch: $actualVersion" }
$gcc = (Get-Command gcc.exe -ErrorAction Stop).Source
$windres = (Get-Command windres.exe -ErrorAction Stop).Source
& (Join-Path $PSScriptRoot 'fetch-engine.ps1')
New-Item -ItemType Directory -Path $stage, $dist -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $stage 'app'), (Join-Path $stage 'engines') -Force | Out-Null
# Explicit source allowlist keeps personal preferences, reports and cached games out.
foreach ($file in @('main.cjs','engine.cjs','preload.cjs','app.mjs','index.html','style.css','audio.mjs','analysis.mjs','analysis-view.mjs')) {
    Copy-Item -LiteralPath (Join-Path $projectRoot "app\$file") -Destination (Join-Path $stage 'app')
}
Copy-Item -LiteralPath (Join-Path $projectRoot 'app\assets') -Destination (Join-Path $stage 'app') -Recurse
New-Item -ItemType Directory -Path (Join-Path $stage 'app\core') -Force | Out-Null
foreach ($file in @('rules.mjs','jieqi-ai.mjs','ai-worker.mjs')) {
    Copy-Item -LiteralPath (Join-Path $projectRoot "app\core\$file") -Destination (Join-Path $stage 'app\core')
}
Copy-Item -LiteralPath $runtime -Destination (Join-Path $stage 'runtime') -Recurse
Copy-Item -LiteralPath (Join-Path $projectRoot 'engines\pikafish') -Destination (Join-Path $stage 'engines') -Recurse
$utf8 = New-Object System.Text.UTF8Encoding($false)
$runtimePackage = [ordered]@{name=$package.name;version=$package.version;private=$true;main=$package.main}
[IO.File]::WriteAllText((Join-Path $stage 'package.json'), ($runtimePackage | ConvertTo-Json), $utf8)
foreach ($file in @('README.md','README.en.md','CHANGELOG.md','LICENSE','THIRD_PARTY_NOTICES.md','使用说明.txt')) {
    Copy-Item -LiteralPath (Join-Path $projectRoot $file) -Destination $stage
}
Copy-Item -LiteralPath (Join-Path $projectRoot 'docs') -Destination $stage -Recurse
Push-Location (Join-Path $projectRoot 'launcher')
try {
    & $windres desktop.rc -O coff -o desktop-release.o
    if ($LASTEXITCODE -ne 0) { throw 'Resource build failed.' }
    & $gcc desktop_launcher.c desktop-release.o -municode -mwindows -O2 -o desktop-release.exe
    if ($LASTEXITCODE -ne 0) { throw 'Launcher build failed.' }
    Copy-Item -LiteralPath 'desktop-release.exe' -Destination (Join-Path $stage '荒野象棋.exe')
} finally { Pop-Location }
$files = @(Get-ChildItem -LiteralPath $stage -Recurse -File)
$manifest = [ordered]@{
    name=$name;version=$package.version;platform='windows-x64';electronVersion=$actualVersion;
    engine='Pikafish 2026-09-06';engineSource='Pikafish-source-2026-09-06.zip';
    files=@($files | ForEach-Object { [ordered]@{
        path=$_.FullName.Substring($stage.Length + 1).Replace('\','/');bytes=$_.Length;
        sha256=(Get-Sha256 $_.FullName)
    }})
}
[IO.File]::WriteAllText((Join-Path $stage 'release-manifest.json'), ($manifest | ConvertTo-Json -Depth 6), $utf8)
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory($stageParent, $zipPath, [IO.Compression.CompressionLevel]::Optimal, $false)
$sourceDestination = Join-Path $dist 'Pikafish-source-2026-09-06.zip'
Copy-Item -LiteralPath (Join-Path $projectRoot '.cache\engine-fetch\Pikafish-source-2026-09-06.zip') -Destination $sourceDestination -Force
$checksums = @($zipPath, $sourceDestination) | ForEach-Object {
    ((Get-Sha256 $_)) + '  ' + [IO.Path]::GetFileName($_)
}
[IO.File]::WriteAllText((Join-Path $dist 'SHA256SUMS.txt'), (($checksums -join "`n") + "`n"), $utf8)
[ordered]@{archive=$zipPath;bytes=(Get-Item -LiteralPath $zipPath).Length;stage=$stage;files=$files.Count} | ConvertTo-Json
