# build-lambda-zip.ps1
# Builds the deployable Lambda bundle with SPEC-CONFORMANT forward-slash entry names.
#
# Why this exists: on Windows PowerShell 5.1, BOTH Compress-Archive and
# System.IO.Compression.ZipFile.CreateFromDirectory write entry names using
# backslash separators ("node_modules\@aws\..."). The ZIP spec (APPNOTE 4.4.17.1)
# requires forward slashes, so such an archive does not resolve node_modules
# correctly when Lambda unpacks it into /var/task. This script writes every entry
# explicitly with '/' separators and fixed DOS timestamps for reproducibility.

[CmdletBinding()]
param(
    [string]$SourceDir = '',
    [string]$OutputZip = '',
    [string]$Include  = 'index.js,package.json,package-lock.json,node_modules'
)

$ErrorActionPreference = 'Stop'

# PSScriptRoot is empty when defaults are evaluated in some hosts, so resolve
# the script directory explicitly from $MyInvocation.
$scriptDir = $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($scriptDir)) {
    $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
}
if ([string]::IsNullOrWhiteSpace($SourceDir)) { $SourceDir = $scriptDir }
# El ZIP se escribe SIEMPRE fuera de $SourceDir. Si se escribiera adentro, una corrida con
# `-Include node_modules` sobre una raíz que contiene el propio ZIP lo empaquetaría dentro de sí
# mismo: un bundle recursivo de ~2.6 MB que AWS acepta pero que no sirve para nada.
if ([string]::IsNullOrWhiteSpace($OutputZip)) {
    $OutputZip = Join-Path (Split-Path -Parent $scriptDir) 'iteradora-lambda.zip'
}
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$SourceDir = (Resolve-Path -LiteralPath $SourceDir).Path
$includeItems = $Include.Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ }

function Get-RelativeEntryName {
    param([string]$Base, [string]$Full)
    $rel = $Full.Substring($Base.Length).TrimStart('\', '/')
    return ($rel -replace '\\', '/')
}

$files = New-Object System.Collections.Generic.List[System.IO.FileInfo]

foreach ($item in $includeItems) {
    $full = Join-Path $SourceDir $item
    if (-not (Test-Path -LiteralPath $full)) {
        throw "Missing required path: $full"
    }
    $resolved = (Resolve-Path -LiteralPath $full).Path
    if (Test-Path -LiteralPath $resolved -PathType Container) {
        foreach ($f in Get-ChildItem -LiteralPath $resolved -Recurse -File -Force) {
            # Nunca empaquetar un .zip: evita recursión si queda alguno dentro del árbol de fuentes.
            if ($f.Extension -ne '.zip') { $files.Add($f) }
        }
    }
    else {
        $files.Add((Get-Item -LiteralPath $resolved))
    }
}

# Deterministic order so identical source yields identical archives.
$sorted = $files | Sort-Object FullName

if (Test-Path -LiteralPath $OutputZip) { Remove-Item -LiteralPath $OutputZip -Force }

$fixedTime = [System.DateTimeOffset]::new(2020, 1, 1, 0, 0, 0, [System.TimeSpan]::Zero).ToUnixTimeSeconds()
$fs = [System.IO.File]::Open($OutputZip, [System.IO.FileMode]::CreateNew)
try {
    $archive = New-Object System.IO.Compression.ZipArchive($fs, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($f in $sorted) {
            $entryName = Get-RelativeEntryName -Base $SourceDir -Full $f.FullName
            $entry = $archive.CreateEntry($entryName, [System.IO.Compression.CompressionLevel]::Optimal)
            $entry.LastWriteTime = [System.DateTimeOffset]::FromUnixTimeSeconds($fixedTime)

            $in = [System.IO.File]::OpenRead($f.FullName)
            try {
                $out = $entry.Open()
                try { $in.CopyTo($out) } finally { $out.Dispose() }
            }
            finally { $in.Dispose() }
        }
    }
    finally { $archive.Dispose() }
}
finally { $fs.Dispose() }

$info = Get-Item -LiteralPath $OutputZip
"REBUILD OK (manual, forward-slash entry names)"
"  source:  $SourceDir"
"  output:  $($info.FullName)"
"  bytes:   $($info.Length)"
"  files:   $($sorted.Count)"