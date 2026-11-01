# Configuration

## Jellyseerr Base URL

Use the address Jellyfin can reach from the server side. This does not need to be the public Jellyseerr URL.

Examples:

```text
http://jellyseerr:5055
http://192.168.1.50:5055
https://jellyseerr.example.com
```

If Jellyfin runs in Docker, don't use `localhost` or `127.0.0.1`. Inside the container those point at the Jellyfin container itself, not your server. If both apps are in the same Docker Compose stack, use the Jellyseerr service name, such as `http://jellyseerr:5055`, which keeps working if IP addresses change. Otherwise use the server's LAN IP.

Use the Test Connection button to check the URL and API key before saving. It tells you whether Jellyseerr could be reached and whether it accepted the key.

## Jellyseerr API Key

Create or copy the API key from Jellyseerr Settings. The key is stored in Jellyfin's plugin configuration and is only used server-side.

Browsers call the Jellyfin plugin endpoints. They do not receive the Jellyseerr API key.

## Users, Approval and Request Limits

Since 0.3.0, requests go to Jellyseerr under the person who made them, not under the Jellyseerr admin. The plugin still uses the admin API key, but tells Jellyseerr which user each request is for. That means Jellyseerr's per-user settings apply: who has to wait for approval, request limits, and who can report problems.

The first time someone requests something, the plugin finds their Jellyseerr account by their Jellyfin user ID. If they don't have one, it imports them from Jellyfin automatically. New accounts get Jellyseerr's default permissions.

### Keeping requests auto-approved

Before 0.3.0, everything was auto-approved because it went in as the admin. There are two ways to keep it that way.

**The easy way (0.3.3 and later):** tick **Approve every request automatically** in the plugin settings. Any request Jellyseerr would leave waiting for an admin is approved by the plugin straight away, with the admin key, so it goes on to Radarr or Sonarr. The request still shows under the person who made it, and request limits set in Jellyseerr still apply. If Jellyseerr refuses the approval for some reason, the request is still made and waits for an admin as usual, and the Jellyfin log says why.

**The Jellyseerr way:** give everyone Auto-Approve in Jellyseerr itself. This also covers requests people make in Jellyseerr directly, not just through Jellyfin:

1. **For new users:** go to Settings, Users and tick **Auto-Approve** under Default Permissions. This also covers users the plugin imports. Make sure **Request** and **Report Issues** are ticked too.
2. **For existing users:** go to Users, tick the box at the top of the list to select everyone, choose **Bulk Edit**, tick **Auto-Approve**, and save.

To approve some people's requests yourself instead, leave Auto-Approve off for them. Their requests show as Pending approval on the Requests page until you approve them in Jellyseerr.

### Request limits

Limits set in Jellyseerr, under Default Permissions or on a user's settings, show at the top of the Requests page, for example "3 of 5 movie requests left this week". Once someone reaches their limit, Jellyseerr turns down new requests until it resets.

## Request Submission

Requests are disabled by default. Enable `Enable Request Submission` after confirming the Jellyseerr URL and API key are correct.

## 4K Requests

4K requests are disabled unless `Enable 4K Requests` is enabled.

## Allowed Jellyfin User IDs

Leave this field empty to allow any authenticated Jellyfin user to submit requests.

To restrict request submission, add one Jellyfin user ID per line. Users not listed can still open the request page, but request submission will be rejected.

## Jellyseerr Availability

The request page uses Jellyseerr's media status for availability and request state. Jellyfin libraries are not scanned by this plugin for availability.

If an item appears available or requested unexpectedly, check the media status in Jellyseerr first.
