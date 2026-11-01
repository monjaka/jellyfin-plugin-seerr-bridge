# Installation

This plugin has two install paths:

- Plugin repository install: best for normal users after releases are published on GitHub.
- Manual install: best for local testing and first-time validation.

## Requirements

- Jellyfin 12.x (12.0 through 12.4). For Jellyfin 10.11.x, use release 0.1.0.5.
- .NET SDK 10.0.x to build from source.
- A working Jellyseerr instance.
- A Jellyseerr API key from Jellyseerr Settings.
- Network access from the Jellyfin server to Jellyseerr.

## Plugin Repository Install

After `manifest.json` and the release zip are published on GitHub:

1. Open Jellyfin Dashboard.
2. Go to Plugins -> Repositories.
3. Add:

   ```text
   Name: Jellyseerr Bridge
   URL: https://raw.githubusercontent.com/monjaka/jellyfin-plugin-jellyseerr-bridge/main/manifest.json
   ```

4. Go to Plugins -> Catalog.
5. Install `Jellyseerr Bridge`.
6. Restart Jellyfin.
7. Configure the plugin.
8. Install the Jellyfin Web navigation button:

   ```bash
   curl -fsSLO https://raw.githubusercontent.com/monjaka/jellyfin-plugin-jellyseerr-bridge/main/scripts/install-web-loader.sh
   less install-web-loader.sh
   sudo bash install-web-loader.sh
   sudo systemctl restart jellyfin
   ```

See [REPOSITORY_INSTALL.md](REPOSITORY_INSTALL.md) for publisher setup.

## Manual Install From Source

Build the plugin:

```bash
dotnet restore
dotnet build -c Release
```

Create a plugin folder on the Jellyfin server:

```bash
sudo mkdir -p /var/lib/jellyfin/plugins/JellyseerrBridge_0.2.0.0
```

Copy the build output into that folder:

```bash
sudo cp src/Jellyfin.Plugin.JellyseerrBridge/bin/Release/net10.0/* /var/lib/jellyfin/plugins/JellyseerrBridge_0.2.0.0/
sudo chown -R jellyfin:jellyfin /var/lib/jellyfin/plugins/JellyseerrBridge_0.2.0.0
```

Restart Jellyfin:

```bash
sudo systemctl restart jellyfin
```

Open Jellyfin Dashboard -> Plugins. Confirm that `Jellyseerr Bridge` is listed.

## Configure The Plugin

Open Jellyfin Dashboard -> Plugins -> Jellyseerr Bridge.

Set:

- `Jellyseerr Base URL`: the URL reachable from the Jellyfin server, such as `http://jellyseerr:5055`. On Docker, don't use `localhost`; see [CONFIGURATION.md](CONFIGURATION.md).
- `Jellyseerr API Key`: from Jellyseerr Settings.

Click Test Connection to check both before saving.
- `Enable Request Submission`: enable this when you want users to submit requests.
- `Enable 4K Requests`: optional.
- `Allowed Jellyfin User IDs`: optional. Leave empty to allow any authenticated Jellyfin user to submit requests.

Save the configuration.

## Open The Request Page

The request page is served by Jellyfin:

```text
https://your-jellyfin-domain/JellyseerrBridge/Page
```

Install the Jellyfin Web loader to add the top `Request` tab and side-menu entry:

```bash
curl -fsSLO https://raw.githubusercontent.com/monjaka/jellyfin-plugin-jellyseerr-bridge/main/scripts/install-web-loader.sh
less install-web-loader.sh
sudo bash install-web-loader.sh
sudo systemctl restart jellyfin
```

The plugin serves this Jellyfin Web entry script:

```text
/JellyseerrBridge/Assets/request-entry.js
```

Loading that script from Jellyfin Web adds:

- a top `Request` tab beside Home and Favourites
- a side-menu `Requests` item

See [WEB_LOADER.md](WEB_LOADER.md) for the native navigation setup and uninstall helper.

## Uninstall

Stop Jellyfin:

```bash
sudo systemctl stop jellyfin
```

Remove the plugin folder:

```bash
sudo rm -rf /var/lib/jellyfin/plugins/JellyseerrBridge_0.2.0.0
```

Remove the plugin configuration if you also want to delete saved settings:

```bash
sudo rm -f /var/lib/jellyfin/plugins/configurations/Jellyfin.Plugin.JellyseerrBridge.xml
```

If you added the optional Jellyfin Web loader tag, remove it with:

```bash
curl -fsSLO https://raw.githubusercontent.com/monjaka/jellyfin-plugin-jellyseerr-bridge/main/scripts/uninstall-web-loader.sh
less uninstall-web-loader.sh
sudo bash uninstall-web-loader.sh
```

Start Jellyfin:

```bash
sudo systemctl start jellyfin
```
