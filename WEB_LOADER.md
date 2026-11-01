# Jellyfin Web Navigation Loader

Since version 0.2.4.0, the plugin adds its navigation script to Jellyfin Web by itself. It edits `index.html` as Jellyfin sends it to the browser, so the file on disk is never changed. That means it works on Docker installs, survives Jellyfin updates, and needs no extra plugins. After installing or updating the plugin, restart Jellyfin and hard refresh the browser.

The script it loads is served by the plugin at:

```text
/JellyseerrBridge/Assets/request-entry.js
```

In the Modern layout (the default in Jellyfin 12) it adds a Request tab beside Home and Favorites on the home page, and a Requests item in the user avatar menu on every page. In the Legacy layout it adds a Request tab beside Home and Favourites, plus a side-menu item.

If a reverse proxy or CDN caches Jellyfin's `index.html`, purge that cache after installing the plugin, or the browser may keep getting the page without the script.

The sections below are only needed if the automatic loader doesn't work in your setup.

## Manual Fallback: Index.html Installer Script



Run this on the Jellyfin server after installing the Jellyseerr Bridge plugin:

```bash
curl -fsSLO https://raw.githubusercontent.com/monjaka/jellyfin-plugin-jellyseerr-bridge/main/scripts/install-web-loader.sh
less install-web-loader.sh
sudo bash install-web-loader.sh
sudo systemctl restart jellyfin
```

The installer:

- finds common Jellyfin Web `index.html` locations
- backs up `index.html` before editing it
- skips the edit if the loader is already present

To remove the loader:

```bash
curl -fsSLO https://raw.githubusercontent.com/monjaka/jellyfin-plugin-jellyseerr-bridge/main/scripts/uninstall-web-loader.sh
less uninstall-web-loader.sh
sudo bash uninstall-web-loader.sh
sudo systemctl restart jellyfin
```

## Manual Loader Tag

On a standard Linux Jellyfin install, Jellyfin Web is commonly under:

```text
/usr/share/jellyfin/web
```

Back up `index.html`:

```bash
sudo cp /usr/share/jellyfin/web/index.html /usr/share/jellyfin/web/index.html.bak.jellyseerrbridge
```

Add this before `</body>`:

```html
<script defer src="/JellyseerrBridge/Assets/request-entry.js"></script>
```

Restart Jellyfin, then hard refresh the browser.

## Upgrade Note

Jellyfin Web updates can replace `index.html`. If the navigation item disappears after a Jellyfin update, re-add the loader tag.

The actual navigation behavior lives inside the plugin-served script, so plugin updates can change the navigation behavior without manually editing this script.

## Direct Link Fallback

The request page still works without the loader:

```text
https://your-jellyfin-domain/JellyseerrBridge/Page
```
