using System.Collections.Generic;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Jellyfin.Plugin.JellyseerrBridge.Models;

/// <summary>
/// Client-visible plugin status.
/// </summary>
public sealed class BridgeStatus
{
    /// <summary>
    /// Gets or sets a value indicating whether Jellyseerr is configured.
    /// </summary>
    [JsonPropertyName("isConfigured")]
    public bool IsConfigured { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether request submission is enabled.
    /// </summary>
    [JsonPropertyName("requestSubmissionEnabled")]
    public bool RequestSubmissionEnabled { get; set; }
}

/// <summary>
/// Request submission body accepted by this plugin.
/// </summary>
public sealed class BridgeRequest
{
    /// <summary>
    /// Gets or sets the media type. Must be movie or tv.
    /// </summary>
    public string MediaType { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the TMDB media ID.
    /// </summary>
    public int MediaId { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether this is a 4K request.
    /// </summary>
    [JsonPropertyName("is4k")]
    public bool Is4K { get; set; }

    /// <summary>
    /// Gets or sets requested TV seasons. Supports "all" or an array of season numbers.
    /// </summary>
    public JsonElement? Seasons { get; set; }
}

/// <summary>
/// The Jellyseerr URL and API key to test from the settings page.
/// </summary>
public sealed class ConnectionTestRequest
{
    /// <summary>
    /// Gets or sets the Jellyseerr base URL. Blank means use the saved one.
    /// </summary>
    [JsonPropertyName("baseUrl")]
    public string? BaseUrl { get; set; }

    /// <summary>
    /// Gets or sets the Jellyseerr API key. Blank means use the saved one.
    /// </summary>
    [JsonPropertyName("apiKey")]
    public string? ApiKey { get; set; }
}

/// <summary>
/// The outcome of a connection test.
/// </summary>
public sealed class ConnectionTestResult
{
    /// <summary>
    /// Gets or sets a value indicating whether Jellyseerr was reached and accepted the API key.
    /// </summary>
    [JsonPropertyName("success")]
    public bool Success { get; set; }

    /// <summary>
    /// Gets or sets the message to show the administrator.
    /// </summary>
    [JsonPropertyName("message")]
    public string Message { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets setup problems found in Jellyseerr that don't stop the connection
    /// working, such as Enable Scan being off for a Radarr or Sonarr server.
    /// </summary>
    [JsonPropertyName("warnings")]
    public IReadOnlyList<string> Warnings { get; set; } = [];
}

/// <summary>
/// A problem report for a title in the library.
/// </summary>
public sealed class BridgeIssue
{
    /// <summary>
    /// Gets or sets Jellyseerr's own media ID for the title (mediaInfo.id), not the TMDB ID.
    /// </summary>
    [JsonPropertyName("mediaInfoId")]
    public int MediaInfoId { get; set; }

    /// <summary>
    /// Gets or sets the kind of problem: 1 video, 2 audio, 3 subtitles, 4 other.
    /// </summary>
    [JsonPropertyName("issueType")]
    public int IssueType { get; set; }

    /// <summary>
    /// Gets or sets the description of the problem.
    /// </summary>
    [JsonPropertyName("message")]
    public string? Message { get; set; }

    /// <summary>
    /// Gets or sets the season with the problem. 0 means all seasons, or a movie.
    /// </summary>
    [JsonPropertyName("problemSeason")]
    public int ProblemSeason { get; set; }

    /// <summary>
    /// Gets or sets the episode with the problem. 0 means all episodes, or a movie.
    /// </summary>
    [JsonPropertyName("problemEpisode")]
    public int ProblemEpisode { get; set; }
}
