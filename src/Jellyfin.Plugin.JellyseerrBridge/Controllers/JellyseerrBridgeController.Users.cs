using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Net.Http;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;
using Jellyfin.Plugin.JellyseerrBridge.Models;
using Jellyfin.Plugin.JellyseerrBridge.Privacy;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.JellyseerrBridge.Controllers;

/// <summary>
/// The parts of the bridge that act as a specific person in Jellyseerr: linking Jellyfin users
/// to Jellyseerr users, and the per-user endpoints built on that (my requests, quotas, issues).
/// </summary>
/// <remarks>
/// Everything still uses the admin API key. Adding an X-Api-User header makes Jellyseerr treat
/// the call as coming from that user, so their permissions, auto-approve settings and request
/// limits apply, and the request shows up under their name.
/// </remarks>
public sealed partial class JellyseerrBridgeController
{
    private const int MyRequestsPageSize = 20;

    // Once found, a Jellyfin user's Jellyseerr ID doesn't change, but keep it only for a while
    // in case an admin deletes and re-imports someone in Jellyseerr.
    private static readonly TimeSpan SeerrUserCacheTime = TimeSpan.FromMinutes(10);

    private static readonly ConcurrentDictionary<string, CachedSeerrUser> SeerrUsers = new(StringComparer.OrdinalIgnoreCase);

    /// <summary>
    /// Lists the signed-in user's own Jellyseerr requests, newest first, with each title's
    /// details and download progress.
    /// </summary>
    /// <param name="page">Page number.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>A page of requests shaped like search results.</returns>
    [HttpGet("MyRequests")]
    public async Task<IActionResult> MyRequests([FromQuery] int page = 1, CancellationToken cancellationToken = default)
    {
        // Each page looks up 20 titles in Jellyseerr, so keep this from being hammered.
        if (RateLimit("my-requests", 60, TimeSpan.FromMinutes(10)) is IActionResult tooMany)
        {
            return tooMany;
        }

        var seerrUser = await ResolveSeerrUserAsync(cancellationToken).ConfigureAwait(false);
        if (seerrUser.Id is not int seerrUserId)
        {
            return StatusCode(403, new { message = seerrUser.Error });
        }

        page = Math.Clamp(page, 1, 250);
        try
        {
            using var client = CreateClient(seerrUserId);
            var path = string.Format(
                CultureInfo.InvariantCulture,
                "/api/v1/request?take={0}&skip={1}&sort=added&filter=all&requestedBy={2}",
                MyRequestsPageSize,
                (page - 1) * MyRequestsPageSize,
                seerrUserId);
            using var response = await client.GetAsync(path, cancellationToken).ConfigureAwait(false);
            if (!response.IsSuccessStatusCode)
            {
                return await ProxyResponseAsync(response, cancellationToken).ConfigureAwait(false);
            }

            var root = JsonNode.Parse(await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false)) as JsonObject;
            var requests = (root?["results"] as JsonArray)?.OfType<JsonObject>().ToList() ?? new List<JsonObject>();
            var totalPages = NodeInt(root?["pageInfo"]?["pages"]) ?? 1;

            // Jellyseerr's request list has no titles or posters, so look each title up.
            // Details are the same for everyone, so these go out as the admin.
            using var detailsClient = CreateClient();
            var items = await Task.WhenAll(requests.Select(request => DescribeRequestAsync(detailsClient, request, cancellationToken))).ConfigureAwait(false);

            var result = new JsonObject
            {
                ["page"] = page,
                ["totalPages"] = Math.Max(totalPages, 1),
                ["results"] = new JsonArray(items.Where(item => item is not null).Select(item => (JsonNode)item!).ToArray())
            };
            return Content(result.ToJsonString(), "application/json");
        }
        catch (Exception ex) when (ex is InvalidOperationException or HttpRequestException or TaskCanceledException or JsonException)
        {
            _logger.LogWarning(ex, "Couldn't load requests for Jellyseerr user {SeerrUserId}", seerrUserId);
            return StatusCode(502, new { message = "Couldn't load your requests from Jellyseerr right now." });
        }
    }

    /// <summary>
    /// Gets the signed-in user's request limits from Jellyseerr.
    /// </summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Jellyseerr's quota response, with movie and tv sections.</returns>
    [HttpGet("Quota")]
    public async Task<IActionResult> Quota(CancellationToken cancellationToken)
    {
        var seerrUser = await ResolveSeerrUserAsync(cancellationToken).ConfigureAwait(false);
        if (seerrUser.Id is not int seerrUserId)
        {
            return StatusCode(403, new { message = seerrUser.Error });
        }

        return await ForwardGetAsync(
            string.Format(CultureInfo.InvariantCulture, "/api/v1/user/{0}/quota", seerrUserId),
            new Dictionary<string, string?>(),
            cancellationToken,
            seerrUserId).ConfigureAwait(false);
    }

    /// <summary>
    /// Reports a problem with a title in the library to Jellyseerr's issue tracker, filed
    /// under the signed-in user.
    /// </summary>
    /// <param name="issue">The problem being reported.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Jellyseerr response.</returns>
    [HttpPost("Issue")]
    public async Task<IActionResult> ReportIssue([FromBody] BridgeIssue issue, CancellationToken cancellationToken)
    {
        var message = issue.Message?.Trim() ?? string.Empty;
        if (issue.MediaInfoId <= 0)
        {
            return BadRequest(new { message = "Only titles that are in the library can have problems reported." });
        }

        // Jellyseerr's issue types: 1 video, 2 audio, 3 subtitles, 4 other.
        if (issue.IssueType is < 1 or > 4)
        {
            return BadRequest(new { message = "Pick what kind of problem it is." });
        }

        if (message.Length == 0 || message.Length > 2000)
        {
            return BadRequest(new { message = "Describe the problem in 2000 characters or fewer." });
        }

        if (issue.ProblemSeason is < 0 or > 500 || issue.ProblemEpisode is < 0 or > 10000)
        {
            return BadRequest(new { message = "That season or episode number doesn't look right." });
        }

        // The allowed users setting covers anything that creates something in Jellyseerr.
        if (!IsUserAllowed(GetConfig()))
        {
            return StatusCode(403, new { message = "Your account isn't allowed to report problems. Ask an admin if you think it should be." });
        }

        if (RateLimit("issue", 5, TimeSpan.FromMinutes(10)) is IActionResult tooMany)
        {
            return tooMany;
        }

        var seerrUser = await ResolveSeerrUserAsync(cancellationToken).ConfigureAwait(false);
        if (seerrUser.Id is not int seerrUserId)
        {
            return StatusCode(403, new { message = seerrUser.Error });
        }

        var payload = JsonSerializer.SerializeToElement(
            new Dictionary<string, object>
            {
                ["issueType"] = issue.IssueType,
                ["message"] = message,
                // Jellyseerr's own media ID, not the TMDB one. Season and episode 0 mean "all".
                ["mediaId"] = issue.MediaInfoId,
                ["problemSeason"] = issue.ProblemSeason,
                ["problemEpisode"] = issue.ProblemEpisode
            },
            JsonOptions);
        return await ForwardPostAsync("/api/v1/issue", payload, cancellationToken, seerrUserId).ConfigureAwait(false);
    }

    /// <summary>
    /// Works out the signed-in Jellyfin user's ID from their token, as 32 hex digits with no
    /// dashes, which is how both Jellyfin and Jellyseerr usually write it.
    /// </summary>
    private string? CurrentJellyfinUserId()
    {
        var raw = User.FindFirstValue("Jellyfin-UserId")
            ?? User.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? User.FindFirstValue("sub");
        return NormalizeUserId(raw);
    }

    private static string? NormalizeUserId(string? value)
    {
        return Guid.TryParse(value, out var id) ? id.ToString("N", CultureInfo.InvariantCulture) : null;
    }

    /// <summary>
    /// Finds the signed-in user's Jellyseerr account, importing them from Jellyfin the first
    /// time if they don't have one yet.
    /// </summary>
    private async Task<SeerrUserLookup> ResolveSeerrUserAsync(CancellationToken cancellationToken)
    {
        var jellyfinUserId = CurrentJellyfinUserId();
        if (jellyfinUserId is null)
        {
            return new SeerrUserLookup(null, "Couldn't tell which Jellyfin user you are. Try signing out and back in.");
        }

        if (SeerrUsers.TryGetValue(jellyfinUserId, out var cached) && cached.Expires > DateTimeOffset.UtcNow)
        {
            return new SeerrUserLookup(cached.Id, null);
        }

        var autoAdd = GetConfig().AutoAddUsersToJellyseerr;
        int? seerrUserId;
        try
        {
            using var client = CreateClient();
            seerrUserId = await FindSeerrUserAsync(client, jellyfinUserId, cancellationToken).ConfigureAwait(false);
            if (seerrUserId is null && autoAdd)
            {
                seerrUserId = await ImportSeerrUserAsync(client, jellyfinUserId, cancellationToken).ConfigureAwait(false);
            }
        }
        catch (InvalidOperationException)
        {
            return new SeerrUserLookup(null, "Jellyseerr Bridge isn't set up yet. Ask an admin to add the Jellyseerr URL and API key.");
        }

        if (seerrUserId is null && !autoAdd)
        {
            return new SeerrUserLookup(
                null,
                "You don't have a Jellyseerr account yet. Ask an admin to add you in Jellyseerr under Users, Import Jellyfin Users.");
        }

        if (seerrUserId is null)
        {
            return new SeerrUserLookup(
                null,
                "Your Jellyfin account isn't linked to Jellyseerr yet, and adding it automatically didn't work. Ask an admin to import you in Jellyseerr under Users, Import Jellyfin Users.");
        }

        SeerrUsers[jellyfinUserId] = new CachedSeerrUser(seerrUserId.Value, DateTimeOffset.UtcNow + SeerrUserCacheTime);
        return new SeerrUserLookup(seerrUserId, null);
    }

    private async Task<int?> FindSeerrUserAsync(HttpClient client, string jellyfinUserId, CancellationToken cancellationToken)
    {
        try
        {
            // Seerr 3.3 and later can look a user up by Jellyfin ID directly.
            using (var direct = await client.GetAsync($"/api/v1/user/jellyfin/{jellyfinUserId}", cancellationToken).ConfigureAwait(false))
            {
                if (direct.IsSuccessStatusCode)
                {
                    var user = JsonNode.Parse(await direct.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false));
                    if (NodeInt(user?["id"]) is int directId)
                    {
                        return directId;
                    }
                }
            }

            // Older versions only have the full user list, so page through it.
            const int take = 100;
            for (var skip = 0; skip < 5000; skip += take)
            {
                var path = string.Format(CultureInfo.InvariantCulture, "/api/v1/user?take={0}&skip={1}", take, skip);
                using var response = await client.GetAsync(path, cancellationToken).ConfigureAwait(false);
                if (!response.IsSuccessStatusCode)
                {
                    return null;
                }

                var root = JsonNode.Parse(await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false));
                var users = (root?["results"] as JsonArray)?.OfType<JsonObject>().ToList() ?? new List<JsonObject>();
                var match = users.FirstOrDefault(user => NormalizeUserId(NodeString(user["jellyfinUserId"])) == jellyfinUserId);
                if (match is not null)
                {
                    return NodeInt(match["id"]);
                }

                if (users.Count < take)
                {
                    return null;
                }
            }
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or JsonException)
        {
            _logger.LogWarning(ex, "Couldn't look up Jellyfin user {JellyfinUserId} in Jellyseerr", jellyfinUserId);
        }

        return null;
    }

    private async Task<int?> ImportSeerrUserAsync(HttpClient client, string jellyfinUserId, CancellationToken cancellationToken)
    {
        try
        {
            var body = JsonSerializer.Serialize(new Dictionary<string, string[]> { ["jellyfinUserIds"] = [jellyfinUserId] });
            using var content = new StringContent(body, Encoding.UTF8, "application/json");
            using var response = await client.PostAsync("/api/v1/user/import-from-jellyfin", content, cancellationToken).ConfigureAwait(false);
            if (!response.IsSuccessStatusCode)
            {
                _logger.LogWarning(
                    "Jellyseerr wouldn't import Jellyfin user {JellyfinUserId} (HTTP {StatusCode})",
                    jellyfinUserId,
                    (int)response.StatusCode);
                return null;
            }

            var imported = JsonNode.Parse(await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false)) as JsonArray;
            var user = imported?.OfType<JsonObject>()
                .FirstOrDefault(entry => NormalizeUserId(NodeString(entry["jellyfinUserId"])) == jellyfinUserId);
            var seerrUserId = NodeInt(user?["id"])
                // Some versions return an empty list when the user already existed, so look again.
                ?? await FindSeerrUserAsync(client, jellyfinUserId, cancellationToken).ConfigureAwait(false);

            if (seerrUserId is not null)
            {
                _logger.LogInformation(
                    "Added Jellyfin user {JellyfinUserId} to Jellyseerr as user {SeerrUserId}",
                    jellyfinUserId,
                    seerrUserId);
            }

            return seerrUserId;
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or JsonException)
        {
            _logger.LogWarning(ex, "Couldn't import Jellyfin user {JellyfinUserId} into Jellyseerr", jellyfinUserId);
            return null;
        }
    }

    /// <summary>
    /// Turns one of Jellyseerr's request records into a title like the search results use, with
    /// a "bridgeRequest" section describing the request itself.
    /// </summary>
    private static async Task<JsonObject?> DescribeRequestAsync(HttpClient client, JsonObject request, CancellationToken cancellationToken)
    {
        var media = request["media"] as JsonObject;
        var tmdbId = NodeInt(media?["tmdbId"]);
        var mediaType = NodeString(media?["mediaType"]) ?? NodeString(request["type"]);
        if (tmdbId is null || mediaType is not ("movie" or "tv"))
        {
            return null;
        }

        JsonObject? details = null;
        try
        {
            var path = string.Format(CultureInfo.InvariantCulture, "/api/v1/{0}/{1}", mediaType, tmdbId);
            using var response = await client.GetAsync(path, cancellationToken).ConfigureAwait(false);
            if (response.IsSuccessStatusCode)
            {
                details = JsonNode.Parse(await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false)) as JsonObject;
            }
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or JsonException)
        {
            // Fall back to what the request record itself has, below.
        }

        details ??= new JsonObject
        {
            ["id"] = tmdbId,
            ["title"] = "Unknown title",
            ["mediaInfo"] = media?.DeepClone()
        };

        // The list only needs the basics; drop the bulky parts of the details.
        foreach (var bulky in new[] { "credits", "relatedVideos", "keywords", "productionCompanies", "networks", "watchProviders" })
        {
            details.Remove(bulky);
        }

        // Same cleaning as every other Jellyseerr answer; the request summary below is ours.
        SeerrResponseSanitizer.Sanitize(details);

        details["mediaType"] = mediaType;
        details["bridgeRequest"] = new JsonObject
        {
            ["status"] = request["status"]?.DeepClone(),
            ["createdAt"] = request["createdAt"]?.DeepClone(),
            ["updatedAt"] = request["updatedAt"]?.DeepClone(),
            ["is4k"] = request["is4k"]?.DeepClone(),
            ["seasons"] = new JsonArray(((request["seasons"] as JsonArray) ?? new JsonArray())
                .Select(season => NodeInt(season?["seasonNumber"]))
                .Where(number => number is not null)
                .Select(number => (JsonNode)JsonValue.Create(number!.Value))
                .ToArray())
        };
        return details;
    }

    private static int? NodeInt(JsonNode? node)
    {
        return node is JsonValue value && value.TryGetValue<int>(out var result) ? result : null;
    }

    private static string? NodeString(JsonNode? node)
    {
        return node is JsonValue value && value.TryGetValue<string>(out var result) ? result : null;
    }

    private sealed record CachedSeerrUser(int Id, DateTimeOffset Expires);

    private sealed record SeerrUserLookup(int? Id, string? Error);
}
