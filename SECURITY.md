# Security

## Supported Versions

The current release line targets Jellyfin 12.x. Release 0.1.0.5 is the last build for Jellyfin 10.11.x and doesn't get security fixes.

## How the Plugin Protects Things

### The Jellyseerr API key

- The key is stored in Jellyfin's plugin settings and is only ever used by the Jellyfin server to talk to Jellyseerr. No plugin endpoint sends it to a browser.
- Once saved, the settings page doesn't show it again. Leave the field blank to keep the saved key, or type a new one to replace it.
- The key is an admin key for Jellyseerr. Anyone who can read Jellyfin's plugin settings (Jellyfin admins, or anyone with access to the server's config folder) can see it, so treat both accordingly.

### Who can do what

- Every plugin endpoint except the request page itself and its scripts needs a signed-in Jellyfin user.
- Testing the Jellyseerr connection is limited to Jellyfin administrators.
- Requests and problem reports go to Jellyseerr under the person making them, so Jellyseerr's per-user permissions, approval rules and request limits apply. The plugin never lets one user act as another: it works out who you are from your Jellyfin sign-in, not from anything the browser sends.
- The Allowed Jellyfin User IDs setting limits who can request titles and report problems.
- Turning off "Add Jellyfin users to Jellyseerr automatically" means only people you've imported into Jellyseerr yourself can request anything.

### Other people's details stay private

The plugin asks Jellyseerr for things with the admin API key, so Jellyseerr answers as if an admin were looking. Before anything is sent to a browser, the plugin removes:

- who requested, approved or reported each title, and their account details (on Jellyseerr versions before Seerr 3.5.0 these could include email addresses)
- problem reports and their comments
- links into Radarr, Sonarr, Plex and Jellyfin, and the IDs Jellyseerr uses for them
- download release names and download client IDs, leaving only the progress

The request page only gets what it shows: titles, statuses, dates and download progress. Fields are only removed if they're there, so this works the same on Seerr 3.5.0 and later, which already leave some of them out.

### Not an open proxy

The plugin only talks to a fixed list of Jellyseerr endpoints, and checks what's passed through:

- Search text is limited to 200 characters, and page numbers to 500.
- Discover filters are only passed on if they look like a date, a rating, a sort order, a region code or a list of provider IDs.
- Requests are limited to a movie or show by TMDB ID, an optional 4K flag, and season numbers.
- Problem reports are limited to the four Jellyseerr issue types, a description of up to 2000 characters, and season and episode numbers.

### Rate limits

Each Jellyfin user can make up to 30 requests and 5 problem reports per 10 minutes, and load the My Requests tab 60 times per 10 minutes. Going over gets a "try again in a few minutes" message. This stops one account, or a stolen sign-in, from flooding Jellyseerr.

### Errors

When Jellyseerr can't be reached or fails, users get a plain message. The details, which can include internal hostnames and ports, go to the Jellyfin log.

### The request page

The request page runs on Jellyfin's own site, where the browser also holds the user's Jellyfin sign-in. To limit the damage if a bug ever let someone slip script into it:

- Everything shown from Jellyseerr is escaped before it's put on the page.
- The page is served with a strict Content-Security-Policy. It can only run the plugin's own scripts, only talk to the Jellyfin server, and only load images from Jellyfin and TMDB. It also sends `X-Content-Type-Options`, `X-Frame-Options` and `Referrer-Policy` headers.
- If Jellyfin Web remembers sign-ins for several servers, the page only uses the one for the server it's open on.
- External links (Rotten Tomatoes, IMDb) only open if they're `https` links, and open without passing along where they came from.

## Recommendations for Admins

- Don't expose Jellyseerr to the internet just for this plugin. Jellyfin only needs to reach it on your internal network (in Docker, by container name, such as `http://jellyseerr:5055`).
- If Jellyfin and Jellyseerr are on different machines, use `https` for the Jellyseerr URL, so the API key isn't sent in the clear.
- If you think the API key has leaked, generate a new one in Jellyseerr under Settings, General, and paste it into the plugin settings.
- Decide who should be auto-approved in Jellyseerr. See "Users, Approval and Request Limits" in CONFIGURATION.md.

## Reporting a Vulnerability

Open a private security advisory on GitHub, or contact the repository owner privately.

Please don't post API keys, Jellyfin tokens, logs containing secrets, or working exploit details in a public issue.
