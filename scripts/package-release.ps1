param(
    [string]$Version = "0.2.0.0",
    [string]$Framework = "net10.0"
)

$ErrorActionPreference = "Stop"

$Project = "src/Jellyfin.Plugin.JellyseerrBridge/Jellyfin.Plugin.JellyseerrBridge.csproj"
$BuildDir = "src/Jellyfin.Plugin.JellyseerrBridge/bin/Release/$Framework"
$DistDir = "dist"
$PluginDir = Join-Path $DistDir "JellyseerrBridge_$Version"
$ZipFile = Join-Path $DistDir "JellyseerrBridge_$Version.zip"

dotnet restore
dotnet build $Project -c Release --no-restore

Remove-Item -Recurse -Force $PluginDir -ErrorAction SilentlyContinue
Remove-Item -Force $ZipFile -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $PluginDir | Out-Null
Copy-Item -Recurse -Force (Join-Path $BuildDir "*") $PluginDir

Compress-Archive -Path $PluginDir -DestinationPath $ZipFile -Force
Get-FileHash -Algorithm MD5 $ZipFile
Write-Output $ZipFile
