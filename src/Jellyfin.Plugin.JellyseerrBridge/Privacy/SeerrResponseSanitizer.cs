using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Jellyfin.Plugin.JellyseerrBridge.Privacy;

/// <summary>
/// Cleans Jellyseerr responses before they go to a browser.
/// </summary>
/// <remarks>
/// The plugin asks Jellyseerr for things with the admin API key, so Jellyseerr answers as if an
/// admin were looking. Those answers can say who requested or reported each title (and, before
/// Seerr 3.5.0, more about those accounts, like email addresses), link into Radarr and Sonarr,
/// and name the exact download. None of that is anyone else's business, and the request page
/// doesn't use it, so it's removed here.
///
/// Everything is removed only if it's there, so this works the same on Seerr versions that
/// already leave some of it out (3.5.0 and later) and on older ones that don't.
/// </remarks>
public static class SeerrResponseSanitizer
{
    // Removed wherever they turn up. The first group is other people's accounts and what they
    // said; the second is links into Radarr, Sonarr, Plex and Jellyfin that admins use.
    private static readonly HashSet<string> RemovedEverywhere = new(StringComparer.Ordinal)
    {
        "requestedBy",
        "modifiedBy",
        "createdBy",
        "issues",
        "comments",
        "serviceUrl",
        "serviceUrl4k",
        "serviceId",
        "serviceId4k",
        "externalServiceId",
        "externalServiceId4k",
        "externalServiceSlug",
        "externalServiceSlug4k",
        "ratingKey",
        "ratingKey4k",
        "mediaUrl",
        "mediaUrl4k",
        "plexUrl",
        "iOSPlexUrl",
        "jellyfinMediaId4k"
    };

    // For lists the request page does use, only these fields are kept on each entry, so anything
    // new Jellyseerr adds to them later stays out until it's deliberately let through.
    private static readonly Dictionary<string, HashSet<string>> KeptInListEntries = new(StringComparer.Ordinal)
    {
        // Each request: just its state, never who made it.
        ["requests"] = new(StringComparer.Ordinal) { "id", "status", "is4k", "createdAt", "updatedAt", "type", "seasons" },
        // Each download: progress only, not the release name or download client ID.
        ["downloadStatus"] = DownloadFields(),
        ["downloadStatus4k"] = DownloadFields(),
        // Seasons inside a request or a title's library status.
        ["seasons"] = new(StringComparer.Ordinal) { "id", "seasonNumber", "status", "status4k", "name", "episodeCount", "airDate", "overview", "posterPath" },
        ["seasonRequests"] = new(StringComparer.Ordinal) { "seasonNumber", "status" }
    };

    private static readonly HashSet<string> KeptEpisodeFields = new(StringComparer.Ordinal) { "seasonNumber", "episodeNumber" };

    /// <summary>
    /// Cleans a Jellyseerr JSON response. Text that isn't JSON is returned unchanged, since
    /// Jellyseerr only ever sends JSON and anything else wouldn't have these fields.
    /// </summary>
    /// <param name="json">The response body.</param>
    /// <returns>The cleaned response body.</returns>
    public static string Sanitize(string json)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            return json;
        }

        JsonNode? root;
        try
        {
            root = JsonNode.Parse(json);
        }
        catch (JsonException)
        {
            return json;
        }

        Sanitize(root);
        return root?.ToJsonString() ?? json;
    }

    /// <summary>
    /// Cleans a parsed Jellyseerr response in place.
    /// </summary>
    /// <param name="node">The parsed response.</param>
    public static void Sanitize(JsonNode? node)
    {
        switch (node)
        {
            case JsonObject obj:
                foreach (var name in obj.Select(pair => pair.Key).Where(RemovedEverywhere.Contains).ToList())
                {
                    obj.Remove(name);
                }

                foreach (var (name, value) in obj.ToList())
                {
                    if (value is JsonArray list && KeptInListEntries.TryGetValue(name, out var kept))
                    {
                        foreach (var entry in list.OfType<JsonObject>())
                        {
                            KeepOnly(entry, kept);
                        }
                    }

                    Sanitize(value);
                }

                break;

            case JsonArray array:
                foreach (var item in array)
                {
                    Sanitize(item);
                }

                break;
        }
    }

    private static HashSet<string> DownloadFields()
    {
        return new(StringComparer.Ordinal) { "mediaType", "size", "sizeLeft", "status", "timeLeft", "estimatedCompletionTime", "episode" };
    }

    private static void KeepOnly(JsonObject entry, HashSet<string> kept)
    {
        foreach (var name in entry.Select(pair => pair.Key).Where(name => !kept.Contains(name)).ToList())
        {
            entry.Remove(name);
        }

        if (entry["episode"] is JsonObject episode)
        {
            KeepOnly(episode, KeptEpisodeFields);
        }
    }
}
