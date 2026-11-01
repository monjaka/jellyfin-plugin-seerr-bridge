#!/usr/bin/env bash
set -euo pipefail

owner="${1:?owner/org is required}"
repo="${2:-jellyfin-plugin-jellyseerr-bridge}"
version="${3:-0.2.0.0}"
tag="${4:-v0.2.0}"
zip_path="${5:-dist/JellyseerrBridge_${version}.zip}"
target_abi="${6:-12.0.0.0}"

if [ ! -f "$zip_path" ]; then
  echo "Release zip not found: $zip_path" >&2
  exit 1
fi

checksum="$(md5sum "$zip_path" | awk '{print $1}')"
timestamp="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
release_url="https://github.com/${owner}/${repo}/releases/download/${tag}/JellyseerrBridge_${version}.zip"
source_url="${release_url}"
repository_url="https://raw.githubusercontent.com/${owner}/${repo}/main/manifest.json"

cat <<JSON
[
  {
    "guid": "d2fcf9c8-c3c7-47e8-9dd6-8de9867e36bb",
    "name": "Jellyseerr Bridge",
    "description": "A Jellyfin plugin that provides a Jellyseerr-powered request page with server-side API-key forwarding.",
    "overview": "Search, discover, and request media from Jellyseerr inside Jellyfin.",
    "owner": "${owner}",
    "category": "General",
    "versions": [
      {
        "version": "${version}",
        "changelog": "Adds support for Jellyfin 12.x (.NET 10). Use 0.1.0.5 for Jellyfin 10.11.x.",
        "targetAbi": "${target_abi}",
        "sourceUrl": "${source_url}",
        "checksum": "${checksum}",
        "timestamp": "${timestamp}",
        "repositoryName": "Jellyseerr Bridge",
        "repositoryUrl": "${repository_url}",
        "url": "${release_url}"
      }
    ]
  }
]
JSON
