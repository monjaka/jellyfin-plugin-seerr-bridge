#!/usr/bin/env bash
set -euo pipefail

version="${1:-0.2.0.0}"
framework="${2:-net10.0}"
project="src/Jellyfin.Plugin.JellyseerrBridge/Jellyfin.Plugin.JellyseerrBridge.csproj"
build_dir="src/Jellyfin.Plugin.JellyseerrBridge/bin/Release/${framework}"
dist_dir="dist"
plugin_dir="${dist_dir}/JellyseerrBridge_${version}"
zip_file="${dist_dir}/JellyseerrBridge_${version}.zip"

dotnet restore
dotnet build "$project" -c Release --no-restore

rm -rf "$plugin_dir" "$zip_file"
mkdir -p "$plugin_dir"
cp -a "$build_dir"/. "$plugin_dir"/

(cd "$dist_dir" && zip -r "JellyseerrBridge_${version}.zip" "JellyseerrBridge_${version}")

if command -v md5sum >/dev/null 2>&1; then
  md5sum "$zip_file"
fi

echo "$zip_file"
