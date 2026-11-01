# Release Guide

## Prepare

Update the version in:

- `Directory.Build.props`
- `manifest.template.json`
- release notes

Build:

```bash
dotnet restore
dotnet build -c Release
```

Package the build output:

```bash
mkdir -p dist/JellyseerrBridge_0.2.0.0
cp src/Jellyfin.Plugin.JellyseerrBridge/bin/Release/net10.0/* dist/JellyseerrBridge_0.2.0.0/
cd dist
zip -r JellyseerrBridge_0.2.0.0.zip JellyseerrBridge_0.2.0.0
md5sum JellyseerrBridge_0.2.0.0.zip
```

## GitHub Release

Create a GitHub release such as:

```text
v0.2.0
```

Attach:

```text
JellyseerrBridge_0.2.0.0.zip
```

## Manifest

Generate `manifest.json` after the release zip exists:

```bash
./scripts/generate-manifest.sh monjaka jellyfin-plugin-jellyseerr-bridge 0.2.0.0 v0.2.0 dist/JellyseerrBridge_0.2.0.0.zip > manifest.new.json
```

PowerShell:

```powershell
.\scripts\generate-manifest.ps1 -Owner monjaka -ZipPath dist\JellyseerrBridge_0.2.0.0.zip > manifest.new.json
```

The generate scripts output a manifest with only the new version. Write it to a scratch file instead of overwriting `manifest.json`, then copy the new version block to the top of the `versions` array in `manifest.json`. Keep the older entries, especially `0.1.0.5` (targetAbi `10.11.0.0`), so servers still on Jellyfin 10.11.x keep getting the build that works for them. Jellyfin offers each server the newest entry whose `targetAbi` it supports.

Commit `manifest.json` so Jellyfin can read it from:

```text
https://raw.githubusercontent.com/monjaka/jellyfin-plugin-jellyseerr-bridge/main/manifest.json
```

Users can add that URL under Jellyfin Dashboard -> Plugins -> Repositories.

Important: Jellyfin downloads the plugin package from the version's `sourceUrl`. That field must point to `JellyseerrBridge_0.2.0.0.zip`, not the GitHub repository page.
