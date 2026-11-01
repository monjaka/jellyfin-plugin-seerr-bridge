param(
    [Parameter(Mandatory = $true)]
    [string]$Owner,

    [string]$Repo = "jellyfin-plugin-jellyseerr-bridge",
    [string]$Version = "0.2.0.0",
    [string]$Tag = "v0.2.0",
    [string]$ZipPath = "dist/JellyseerrBridge_0.2.0.0.zip",
    [string]$TargetAbi = "12.0.0.0"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $ZipPath)) {
    throw "Release zip not found: $ZipPath"
}

$Checksum = (Get-FileHash -Algorithm MD5 -LiteralPath $ZipPath).Hash.ToLowerInvariant()
$Timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$ReleaseUrl = "https://github.com/$Owner/$Repo/releases/download/$Tag/JellyseerrBridge_$Version.zip"
$SourceUrl = $ReleaseUrl
$RepositoryUrl = "https://raw.githubusercontent.com/$Owner/$Repo/main/manifest.json"

$Manifest = @(
    @{
        guid = "d2fcf9c8-c3c7-47e8-9dd6-8de9867e36bb"
        name = "Jellyseerr Bridge"
        description = "A Jellyfin plugin that provides a Jellyseerr-powered request page with server-side API-key forwarding."
        overview = "Search, discover, and request media from Jellyseerr inside Jellyfin."
        owner = $Owner
        category = "General"
        versions = @(
            @{
                version = $Version
                changelog = "Adds support for Jellyfin 12.x (.NET 10). Use 0.1.0.5 for Jellyfin 10.11.x."
                targetAbi = $TargetAbi
                sourceUrl = $SourceUrl
                checksum = $Checksum
                timestamp = $Timestamp
                repositoryName = "Jellyseerr Bridge"
                repositoryUrl = $RepositoryUrl
                url = $ReleaseUrl
            }
        )
    }
)

ConvertTo-Json -InputObject $Manifest -Depth 10
