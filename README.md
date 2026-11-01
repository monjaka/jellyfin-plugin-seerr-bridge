# Seerr Bridge for Jellyfin

Search for movies and shows, request them, and watch them download, all without leaving Jellyfin. Seerr Bridge adds a Requests page to Jellyfin that talks to your [Seerr](https://github.com/seerr-team/seerr) (formerly Jellyseerr) server behind the scenes, so your users never need a separate login or app, and your Seerr API key never leaves the Jellyfin server.

<img width="1117" height="283" alt="The Request tab next to Home and Favorites in Jellyfin" src="https://github.com/user-attachments/assets/2d508176-25dd-4d94-9e12-2fc7458b2387" />
<img width="1488" height="641" alt="The Requests page" src="https://github.com/user-attachments/assets/7ff5b1f4-e7d5-47b2-804d-bf067ac31f5c" />

## Features

**The Requests page**

- Search, plus Trending, Movies, Shows and Upcoming lists, with filters for rating, release date and streaming service, and sorting.
- Clear status on every title: Pending approval, Approved, Downloading, Partially available or Available.
- Live download progress with time left, which updates by itself while the page is open. Shows list each season's progress separately.
- A warning when something was approved over 30 minutes ago but still isn't downloading.
- Detail pages with ratings (TMDB, IMDb and Rotten Tomatoes), cast, similar titles, and every film in a collection with one button to request the missing ones.
- An Open in Jellyfin button once a title is in your library.
- A My Requests tab showing what you've asked for and how each one is going.
- Your request limits at the top of the page, if you've set any in Seerr.
- Report a problem (video, audio, subtitles or something else) on anything in the library. Reports go to Seerr's issue tracker.

**Inside Jellyfin**

- A Request tab next to Home and Favorites, and a Requests entry in the user menu. These are added automatically, with no files to edit.
- A Request seasons button on show pages that lists every season as In library, Missing, Requested and so on. Missing seasons start ticked, so getting all of them is one click, or you can pick and choose.

**For admins**

- Requests are made in Seerr under each person's own account, so they show the right name. Seerr's approval rules and request limits apply.
- New users are added to Seerr automatically the first time they request something, unless you turn that off.
- An optional setting approves every request automatically, so nobody waits for you.
- A Test Connection button that checks the URL and API key, and warns about common Seerr setup problems.

## Requirements

- **Jellyfin 12.0 or later.** For Jellyfin 10.11, use version 0.1.0.5. The plugin repository below offers each server the right version automatically.
- **Seerr or Jellyseerr**, set up with your Jellyfin server and at least one Radarr or Sonarr server.

## Install

1. In Jellyfin, go to **Dashboard**, then **Plugins**, then **Repositories**, and add:

   ```text
   https://raw.githubusercontent.com/kjkoeller/jellyfin-plugin-seerr-bridge/main/manifest.json
   ```

2. Open the **Catalog**, install **Jellyseerr Bridge**, and restart Jellyfin.
3. Open the plugin's settings and fill in:
   - **Jellyseerr Base URL**: the address the Jellyfin *server* uses to reach Seerr, including the port. See [Docker](#docker) below before using `localhost`.
   - **Jellyseerr API Key**: from Seerr under Settings, General.
4. Click **Test Connection**. Fix anything it flags, then tick **Enable request submission** and save.
5. Hard refresh Jellyfin in your browser (Ctrl+Shift+R). The Request tab should appear next to Home and Favorites.

The Requests page is also at `https://your-jellyfin-address/JellyseerrBridge/Page`.

## Setup tips

### Docker

If Jellyfin runs in Docker, **don't use `localhost` or `127.0.0.1`** for the Seerr URL. Inside the container, those point at the Jellyfin container itself. If Seerr is in the same Docker Compose file, use its service name, for example `http://jellyseerr:5055`, which also keeps working if IP addresses change. Otherwise use the server's LAN IP.

### Download progress

Progress only shows if Seerr is watching your download queues. In Seerr, go to Settings, then Services, edit each Radarr and Sonarr server, and make sure **Enable Scan** is on. Test Connection warns you if it isn't.

### Approval and request limits

Since 0.3.0, requests go to Seerr under the person who made them, so Seerr's per-user settings decide whether they need approving. To skip approval for everyone, either:

- tick **Approve every request automatically** in the plugin settings, or
- give everyone **Auto-Approve** in Seerr under Settings, then Users, then Default Permissions (and use Bulk Edit for existing users).

If your Jellyfin is reachable from the internet, set request limits in Seerr as well, for example 10 movies a week. They show at the top of the Requests page. See [CONFIGURATION.md](CONFIGURATION.md) for the details.

## Which apps show it

The Request tab and season button come from Jellyfin's web interface, so they show in apps built on it:

- **Yes:** Jellyfin in a web browser, the official Jellyfin apps for Android phones and iPhone, and Jellyfin Media Player and the desktop apps.
- **Probably:** the Samsung (Tizen) and LG (webOS) TV apps, which are web-based too, but using them with a TV remote hasn't been tested.
- **No:** native apps, including Jellyfin for Android TV and Fire TV, Swiftfin on Apple TV and iPhone, Roku, Findroid, Streamyfin and Infuse. These draw their own screens, so a plugin can't add to them. People using them can request from their phone instead.

## Troubleshooting

**The Request tab doesn't show up.** Hard refresh first. If it's still missing, open the browser console (F12) and run `!!document.getElementById("jellyseerr-bridge-request-entry-style")`. If it says `false`, check that the plugin is installed and Jellyfin was restarted after installing or updating it. If you use Cloudflare or another proxy that caches pages, purge its cache.

**Search shows nothing.** Run Test Connection in the plugin settings. It's almost always the Seerr URL, often `localhost` in Docker, or an API key that has changed.

**No download progress.** Turn on Enable Scan for Radarr and Sonarr in Seerr (see above).

**Everything sits at Pending approval.** See [Approval and request limits](#approval-and-request-limits).

**Someone can't request anything.** Check the Allowed Jellyfin User IDs list in the plugin settings. If "Add Jellyfin users to Jellyseerr automatically" is off, they also need importing in Seerr under Users, Import Jellyfin Users. The Jellyfin log has a line from Jellyseerr Bridge whenever a request fails.

## Security

The Seerr API key stays on the Jellyfin server and is never shown again once saved. Users only get what the Requests page displays: other people's details, admin links and download names are stripped out before anything reaches a browser. Every endpoint except the page itself needs a Jellyfin sign-in, requests and reports are rate limited per user, and the page is served with a strict Content-Security-Policy. [SECURITY.md](SECURITY.md) covers all of it, with recommendations for admins.

## Building from source

You'll need the [.NET 10 SDK](https://dotnet.microsoft.com/download).

```bash
dotnet build -c Release
```

The plugin ends up in `src/Jellyfin.Plugin.JellyseerrBridge/bin/Release/net10.0/`. Releases are built by GitHub Actions when a `v*` tag is pushed; see [RELEASE.md](RELEASE.md).

## More documentation

- [CONFIGURATION.md](CONFIGURATION.md): every setting, and how users and approval work
- [SECURITY.md](SECURITY.md): how the plugin protects your server and users
- [CHANGELOG.md](CHANGELOG.md): what changed in each version
- [WEB_LOADER.md](WEB_LOADER.md): how the Request tab gets into Jellyfin, with manual fallbacks
- [INSTALL.md](INSTALL.md): manual installation

## Credits

Based on [jellyfin-plugin-jellyseerr-bridge](https://github.com/monjaka/jellyfin-plugin-jellyseerr-bridge) by alternate.redirect. Released under the [MIT License](LICENSE).
