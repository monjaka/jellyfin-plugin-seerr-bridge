# Changelog

## 0.3.3.0

Optional automatic approval for every request.

Changes:

- New setting, Approve every request automatically. When it's on, any request Jellyseerr leaves waiting for an admin is approved by the plugin straight away using the admin key, so it goes on to Radarr or Sonarr. This works whether or not a user's Jellyseerr account has Auto-Approve.
- Requests are still made under the person asking, and Jellyseerr still checks their request limits. Only requests that come back as waiting for approval are touched; ones Jellyseerr already approved are left alone.
- If Jellyseerr refuses the approval, the request still goes through and waits for an admin as before, and the reason is written to the Jellyfin log.

## 0.3.2.0

Stops other users' details and admin-only information reaching the browser.

Changes:

- Everything the plugin passes on from Jellyseerr is now cleaned on the server first. Jellyseerr answers the plugin as if an admin were asking, so its responses could include who requested or reported each title (with email addresses on versions before Seerr 3.5.0), problem report comments, links into Radarr and Sonarr, and download release names. Any signed-in Jellyfin user could see these in the browser's developer tools. They're now removed, and the request page looks exactly the same.
- Fields are only removed if they're present, so this works with Seerr 3.5.0 and later, which already strip some of them, and with older Jellyseerr versions that don't.
- For requests, downloads and seasons, only the fields the request page uses are kept, so anything Jellyseerr adds to them in future stays out until it's deliberately let through.

## 0.3.1.0

Security hardening for admins and users. SECURITY.md describes everything the plugin now does.

Changes:

- Users get a plain message when Jellyseerr can't be reached or fails. The details, which can include internal hostnames and ports, go to the Jellyfin log instead of the browser.
- The request page is served with a strict Content-Security-Policy and `X-Content-Type-Options`, `X-Frame-Options` and `Referrer-Policy` headers. The page can see the user's Jellyfin sign-in, so this limits what an injected script could do if a bug ever allowed one.
- Search text, page numbers, discover filters and problem report fields are checked before being passed to Jellyseerr. Filter values that don't look like what the request page sends are dropped.
- Per-user rate limits: 30 requests and 5 problem reports per 10 minutes, and 60 loads of My Requests. Going over gets a "try again in a few minutes" message.
- New setting to turn off adding Jellyfin users to Jellyseerr automatically, for admins who want to choose who gets an account.
- The Allowed Jellyfin User IDs setting now covers problem reports as well as requests, and people not on the list get a clear message instead of a bare 403.
- The settings page no longer shows the saved Jellyseerr API key. Leave the field blank to keep it, or type a new one to replace it.
- If Jellyfin Web remembers sign-ins for several servers, the request page and show page button only use the one for the server they're running on.

## 0.3.0.0

Requests now belong to the person who made them, with a My Requests tab, request limits and problem reports built on that.

Upgrade note: requests used to go to Jellyseerr as the admin, so they were always auto-approved. Now Jellyseerr's per-user settings apply. To keep everything auto-approved, see "Users, Approval and Request Limits" in CONFIGURATION.md.

Changes:

- Requests go to Jellyseerr under the Jellyfin user who made them. The plugin keeps using the admin API key and tells Jellyseerr who each request is for, so per-user approval rules and request limits apply, and requests show the right name in Jellyseerr.
- The plugin finds each person's Jellyseerr account by their Jellyfin user ID. If they don't have one, it imports them from Jellyfin the first time they request something.
- New My Requests tab listing the signed-in user's own requests, newest first, with each title's status and download progress. Declined requests, and ones that couldn't be sent for download, are marked in red.
- Request limits set in Jellyseerr now show at the top of the Requests page, for example "3 of 5 movie requests left this week". They're checked again after each request.
- Titles in the library get a Report a problem button on their detail page. Reports go to Jellyseerr's issue tracker under the person reporting, with the kind of problem, a description, and for shows the season and episode.
- The allowed users setting now matches IDs whether they're pasted with or without dashes.
- Requests no longer pick a Radarr or Sonarr server, quality profile or folder themselves. Jellyseerr uses its default server, which it does anyway when none is given, and it doesn't let regular users choose those.

## 0.2.10.0

Flags requests that were approved a while ago but still aren't downloading.

Changes:

- If a title has been approved for more than 30 minutes and nothing is downloading, its detail page now says how long ago it was approved and that Radarr or Sonarr may not have found a copy yet, or that the download may have finished without Jellyfin picking it up. Before, it said "waiting" indefinitely.
- Titles that are actively downloading don't get the note, since their progress bar already shows what's happening.

## 0.2.9.0

Fixes the Test Connection button and has it check Jellyseerr's Radarr and Sonarr setup.

Changes:

- Fixed Test Connection always failing with "Jellyfin answered with HTTP response.status". Jellyfin Web replaces anything written like `${...}` in a plugin's settings page with a translation, which wiped out the sign-in token the button was sending. The settings page script no longer uses that syntax.
- Test Connection now also looks at the Radarr and Sonarr servers set up in Jellyseerr. It warns when Enable Scan is off for one of them, since download progress can't show without it, and when no Radarr or Sonarr server is set up at all. Warnings don't fail the test.

## 0.2.8.0

Request missing seasons straight from a show's page in Jellyfin.

Changes:

- Show pages in Jellyfin get a Request seasons button next to Play and Favorite, labelled with how many seasons are missing. It only appears when there's something to request and request submission is turned on.
- The button opens a list of every season marked In library, Partly in library, Missing, Requested, Downloading or Not aired yet. Missing seasons start ticked, so requesting all of them is one click. Any missing or upcoming season can be ticked or unticked before sending.
- Which seasons count as missing comes from both Jellyseerr (every season the show has, and what's already requested) and Jellyfin (which episodes are on disk), so it's right even if Jellyseerr hasn't scanned the library lately. Specials are left out.
- The chosen seasons go to Jellyseerr as one request, and the dialog links to the Requests page to follow progress.

## 0.2.7.0

Richer detail pages, and a way back into Jellyfin once something's in the library.

Changes:

- Titles in the library get an Open in Jellyfin button on their card and detail page. Shows that are only partly in the library keep their Request button as well.
- The detail page says when a title was last requested. If that request was declined, or couldn't be sent to Radarr or Sonarr, it says so instead of quietly showing the title as not available again.
- Detail pages show IMDb and Rotten Tomatoes ratings alongside the TMDB score, linking to the rating sites.
- Detail pages show the main cast.
- Movies that belong to a collection list every film in it, oldest first, with a button that requests all the missing ones.
- Detail pages end with a row of similar titles, each with its own status and request button.
- New plugin endpoints for ratings, similar titles and collections. They only pass through to the matching Jellyseerr endpoints, like the existing ones. Ratings fall back to Rotten Tomatoes only on Jellyseerr versions without IMDb support.

## 0.2.6.0

Shows where each request stands, including download progress, on the request page.

Changes:

- Titles now show Pending approval, Approved, Downloading, Partially available or Available, instead of one "Requested" label for everything in between.
- While a movie or episode is downloading, its card and detail page show a progress bar with the percentage and time left. Shows list how many episodes are downloading, and each season shows its own progress.
- Anything waiting or downloading is re-checked every 30 seconds while the page is open, so progress updates without a reload. Checks pause while the browser tab is in the background.
- After a request is sent, the page looks up its real status from Jellyseerr, so auto-approved requests show as approved or downloading straight away.
- The detail page explains what Pending approval and Approved mean.
- Progress comes from Jellyseerr, which checks Radarr and Sonarr about once a minute, so it can lag slightly behind the download client.

## 0.2.5.0

Security and reliability fixes, plus a connection test on the settings page.

Changes:

- `/JellyseerrBridge/Status` now needs a signed-in Jellyfin user and no longer returns the Jellyseerr host, so an internet-facing server doesn't reveal internal addresses to anyone who asks.
- Calls to Jellyseerr now go through Jellyfin's shared HTTP client factory instead of creating a new HttpClient each time, which avoids running out of sockets under load.
- If Jellyseerr's Radarr or Sonarr settings come back in an unexpected shape, requests are sent without the default server and profile instead of failing with an error. The problem is logged as a warning.
- New Test Connection button on the settings page. It checks the URL and API key typed in the form, before saving, and explains the common Docker `localhost` mistake when it happens.
- The settings page and docs now suggest `http://jellyseerr:5055` instead of an IP address, with a note about `localhost` in Docker.

## 0.2.4.0

The plugin now adds the Request tab to Jellyfin Web by itself. No index.html edit or extra plugin is needed.

Changes:

- Adds the Request tab loader to Jellyfin Web's index.html as the server sends it to the browser. The file on disk isn't changed, so this works on Docker installs and keeps working after Jellyfin image updates.
- Skips adding the loader if the page already has it, for example from an older manual index.html edit.
- The tab script only runs once even if it's loaded more than one way.

## 0.2.3.0

Rebuild of 0.2.2.0 with the updated `request-entry.js`. The 0.2.2.0 package shipped the old script by mistake, so none of the 0.2.1.0 or 0.2.2.0 navigation changes below reached Jellyfin until this release.

## 0.2.2.0

Puts the Request tab in the Modern layout's Home/Favorites tab bar.

Changes:

- The Request tab now goes in the Modern layout's Home/Favorites tab bar, styled like the tabs beside it.
- Removed the header button added in 0.2.1.0. It could appear before the tab bar finished loading and stop the tab from being added.
- The avatar menu entry stays, so Requests can still be reached from pages without the tab bar.

## 0.2.1.0

Adds the Requests entry to Jellyfin 12's Modern layout, which has no side drawer on desktop.

Changes:

- Adds a Requests button to the Modern header, next to the user avatar, when there's no Home/Favorites tab bar to add a tab to.
- Adds a Requests item to the user avatar menu, above Sign Out.
- Documents loading the navigation script through the JavaScript Injector plugin, which keeps working on Docker installs and after Jellyfin updates.

## 0.2.0.0

Adds support for Jellyfin 12.x. This build does not load on Jellyfin 10.11.x; servers on 10.11.x should stay on 0.1.0.5, which remains in the plugin repository manifest.

Changes:

- Targets .NET 10 and builds against Jellyfin.Controller and Jellyfin.Model 12.0.0, with targetAbi 12.0.0.0 so the build covers 12.0 through 12.4.
- The request page no longer sends the legacy `X-Emby-Token` header. Jellyfin 12 disables legacy authorization by default, and the standard `Authorization: MediaBrowser` header was already being sent.
- Release scripts, manifest generators and the CI workflow default to `net10.0`, version 0.2.0.0 and targetAbi 12.0.0.0.
- The CI workflow uses the .NET 10 SDK and takes the package name from the plugin version instead of a hard-coded 0.1.0.0.
- Updated install, release and security docs for Jellyfin 12.

## 0.1.0.5

Simplifies installation around the standard Jellyfin plugin install plus one web-loader installer command.

Changes:

- Removed the experimental automatic Plugin Pages and Jellyfin Web self-injection behavior.
- Restored the plugin to server-side APIs, request page, and dashboard settings only.
- Moved the user-facing Jellyfin Web navigation setup to `scripts/install-web-loader.sh`.
- Reworked the README so the standard install steps are at the top.

## 0.1.0.4

Adds a Jellyfin Plugin Pages home-menu entry, matching the integration style used by Jellyfin Enhanced.

Fixes:

- Restores the plugin settings page as the only Jellyfin dashboard plugin page.
- Adds `Request` to Plugin Pages configuration when that integration is installed.
- Keeps Jellyfin Web `index.html` injection as a fallback when the web root is writable.

## 0.1.0.3

Restores the dashboard settings page and moves the user-facing navigation to the Jellyfin Web loader.

Fixes:

- The plugin `Settings` button opens settings again instead of the request page.
- The request entry is injected into Jellyfin Web on plugin startup, similar to Jellyfin Enhanced.
- The dashboard-only `Request` plugin page from `0.1.0.1` and `0.1.0.2` has been removed.

## 0.1.0.2

Aligns the plugin DLL assembly version with the Jellyfin package version.

Fixes:

- Jellyfin no longer reports the loaded plugin assembly as `1.0.0.0`.

## 0.1.0.1

Adds a built-in Jellyfin main-menu `Request` page using Jellyfin's plugin page system.

Fixes:

- Main-menu access no longer requires editing Jellyfin Web's `index.html`.
- Release tooling now emits Jellyfin-compatible MD5 package checksums.

## 0.1.0.0

Initial preview release.

Features:

- Jellyfin-hosted Jellyseerr request page.
- Search and discover media from Jellyseerr.
- Movie and TV detail pages.
- Per-season request buttons for TV.
- Jellyseerr-provided availability and request state.
- Filters for rating, release date, and major streaming providers.
- Sorting by release date, title, and rating.
- Infinite scroll for request results.
- Plugin-served Jellyfin Web navigation entry script.
- Server-side Jellyseerr API forwarding without exposing the API key to browsers.
