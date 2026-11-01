using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Jellyfin.Plugin.JellyseerrBridge.Configuration;
using Jellyfin.Plugin.JellyseerrBridge.Models;
using Jellyfin.Plugin.JellyseerrBridge.Privacy;
using MediaBrowser.Common.Net;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.JellyseerrBridge.Controllers;

/// <summary>
/// Server-side bridge from Jellyfin to Jellyseerr.
/// </summary>
[ApiController]
[Authorize]
[Route("JellyseerrBridge")]
public sealed partial class JellyseerrBridgeController : ControllerBase
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private readonly IHttpClientFactory _httpClientFactory;
    private readonly ILogger<JellyseerrBridgeController> _logger;

    /// <summary>
    /// Initializes a new instance of the <see cref="JellyseerrBridgeController"/> class.
    /// </summary>
    /// <param name="httpClientFactory">Jellyfin's shared HTTP client factory.</param>
    /// <param name="logger">Logger.</param>
    public JellyseerrBridgeController(IHttpClientFactory httpClientFactory, ILogger<JellyseerrBridgeController> logger)
    {
        _httpClientFactory = httpClientFactory;
        _logger = logger;
    }

    /// <summary>
    /// Gets bridge status for signed-in users. It says whether the bridge is set up, but
    /// not where Jellyseerr lives, since this server may be reachable from the internet.
    /// </summary>
    /// <returns>Bridge status.</returns>
    [HttpGet("Status")]
    public ActionResult<BridgeStatus> Status()
    {
        var config = GetConfig();
        return new BridgeStatus
        {
            IsConfigured = TryCreateBaseUri(config) is not null && !string.IsNullOrWhiteSpace(config.JellyseerrApiKey),
            RequestSubmissionEnabled = config.EnableRequestSubmission
        };
    }

    /// <summary>
    /// Checks that Jellyseerr can be reached and that the API key works. Used by the
    /// Test Connection button on the settings page, so it's limited to administrators.
    /// </summary>
    /// <param name="request">The URL and key to test. Blank values fall back to the saved settings.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Whether the connection worked, with a message to show the admin.</returns>
    [HttpPost("TestConnection")]
    [Authorize(Policy = "RequiresElevation")]
    public async Task<ActionResult<ConnectionTestResult>> TestConnection([FromBody] ConnectionTestRequest request, CancellationToken cancellationToken)
    {
        var config = GetConfig();
        var baseUrl = string.IsNullOrWhiteSpace(request.BaseUrl) ? config.JellyseerrBaseUrl : request.BaseUrl.Trim();
        var apiKey = string.IsNullOrWhiteSpace(request.ApiKey) ? config.JellyseerrApiKey : request.ApiKey.Trim();

        var baseUri = TryCreateBaseUri(baseUrl);
        if (baseUri is null)
        {
            return TestFailed("Enter a full URL starting with http:// or https://, for example http://jellyseerr:5055.");
        }

        if (string.IsNullOrWhiteSpace(apiKey))
        {
            return TestFailed("Enter the Jellyseerr API key. You can find it in Jellyseerr under Settings, General.");
        }

        using var client = CreateClient(baseUri, apiKey);

        string? version;
        try
        {
            using var statusResponse = await client.GetAsync("/api/v1/status", cancellationToken).ConfigureAwait(false);
            if (!statusResponse.IsSuccessStatusCode)
            {
                return TestFailed($"Something answered at {baseUri.Authority}, but not like Jellyseerr does (HTTP {(int)statusResponse.StatusCode}). Check the URL and port.");
            }

            version = await ReadVersionAsync(statusResponse, cancellationToken).ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            return TestFailed(UnreachableMessage(baseUri, ex));
        }

        var jellyseerrName = version is null ? "Jellyseerr" : $"Jellyseerr {version}";
        try
        {
            using var meResponse = await client.GetAsync("/api/v1/auth/me", cancellationToken).ConfigureAwait(false);
            if (meResponse.StatusCode is System.Net.HttpStatusCode.Unauthorized or System.Net.HttpStatusCode.Forbidden)
            {
                return TestFailed($"Reached {jellyseerrName}, but it rejected the API key. Copy the key again from Jellyseerr under Settings, General.");
            }

            if (!meResponse.IsSuccessStatusCode)
            {
                return TestFailed($"Reached {jellyseerrName}, but checking the API key failed with HTTP {(int)meResponse.StatusCode}.");
            }
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            return TestFailed($"Reached {jellyseerrName}, but the connection dropped while checking the API key: {ex.Message}");
        }

        var warnings = new List<string>();
        await AddServiceWarningsAsync(client, "/api/v1/settings/radarr", "Radarr", "movie", warnings, cancellationToken).ConfigureAwait(false);
        await AddServiceWarningsAsync(client, "/api/v1/settings/sonarr", "Sonarr", "show", warnings, cancellationToken).ConfigureAwait(false);

        return new ConnectionTestResult
        {
            Success = true,
            Message = warnings.Count == 0
                ? $"Connected to {jellyseerrName} and the API key works. Remember to save."
                : $"Connected to {jellyseerrName} and the API key works, but a few Jellyseerr settings need a look:",
            Warnings = warnings
        };
    }

    /// <summary>
    /// Looks at Jellyseerr's Radarr or Sonarr servers for setup problems that would quietly
    /// break things on the request page. Nothing here fails the test; it only adds warnings.
    /// </summary>
    private static async Task AddServiceWarningsAsync(HttpClient client, string endpoint, string serviceName, string mediaWord, List<string> warnings, CancellationToken cancellationToken)
    {
        try
        {
            using var response = await client.GetAsync(endpoint, cancellationToken).ConfigureAwait(false);
            if (!response.IsSuccessStatusCode)
            {
                return;
            }

            await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken).ConfigureAwait(false);
            using var document = await JsonDocument.ParseAsync(stream, cancellationToken: cancellationToken).ConfigureAwait(false);
            if (document.RootElement.ValueKind != JsonValueKind.Array)
            {
                return;
            }

            var servers = document.RootElement.EnumerateArray().Where(server => server.ValueKind == JsonValueKind.Object).ToList();
            if (servers.Count == 0)
            {
                warnings.Add($"No {serviceName} server is set up in Jellyseerr, so {mediaWord} requests won't be downloaded.");
                return;
            }

            foreach (var server in servers)
            {
                // "syncEnabled" is the Enable Scan switch. Without it Jellyseerr doesn't watch
                // the download queue, so the request page can't show download progress.
                if (ReadBool(server, "syncEnabled"))
                {
                    continue;
                }

                var name = ReadString(server, "name");
                var label = string.IsNullOrWhiteSpace(name) ? serviceName : $"{serviceName} server \"{name}\"";
                warnings.Add($"Enable Scan is off for {label}, so download progress won't show for {mediaWord}s it handles. Turn it on in Jellyseerr under Settings, Services.");
            }
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or JsonException)
        {
            // These checks are extras. If they can't run, the connection test itself still stands.
        }
    }

    private static ConnectionTestResult TestFailed(string message)
    {
        return new ConnectionTestResult { Success = false, Message = message };
    }

    private static string UnreachableMessage(Uri baseUri, Exception ex)
    {
        var message = $"Couldn't reach Jellyseerr at {baseUri.Authority}: {ex.Message}";
        if (baseUri.IsLoopback)
        {
            // The mistake that's easiest to make: in Docker, localhost is the Jellyfin container itself.
            message += " If Jellyfin runs in Docker, localhost means the Jellyfin container itself, not your server. Use the Jellyseerr container name instead, for example http://jellyseerr:5055.";
        }

        return message;
    }

    private static async Task<string?> ReadVersionAsync(HttpResponseMessage response, CancellationToken cancellationToken)
    {
        try
        {
            await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken).ConfigureAwait(false);
            using var document = await JsonDocument.ParseAsync(stream, cancellationToken: cancellationToken).ConfigureAwait(false);
            return document.RootElement.ValueKind == JsonValueKind.Object ? ReadString(document.RootElement, "version") : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    /// <summary>
    /// Serves the standalone request page.
    /// </summary>
    /// <returns>HTML page.</returns>
    [HttpGet("Page")]
    [AllowAnonymous]
    public IActionResult Page()
    {
        AddPageSecurityHeaders();
        return EmbeddedFile("Web.request-page.html", "text/html; charset=utf-8");
    }

    /// <summary>
    /// Serves plugin web assets.
    /// </summary>
    /// <param name="assetName">Asset name.</param>
    /// <returns>Asset response.</returns>
    [HttpGet("Assets/{assetName}")]
    [AllowAnonymous]
    public IActionResult Asset(string assetName)
    {
        var resourceName = assetName switch
        {
            "request-page.js" => "Web.request-page.js",
            "request-entry.js" => "Web.request-entry.js",
            _ => null
        };

        return resourceName is null
            ? NotFound()
            : EmbeddedFile(resourceName, "application/javascript; charset=utf-8");
    }

    /// <summary>
    /// Proxies a Jellyseerr search request.
    /// </summary>
    /// <param name="query">Search query.</param>
    /// <param name="page">Page number.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Jellyseerr response.</returns>
    [HttpGet("Search")]
    public Task<IActionResult> Search([FromQuery] string query, [FromQuery] int page = 1, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(query))
        {
            return Task.FromResult<IActionResult>(BadRequest(new { message = "Query is required." }));
        }

        if (query.Length > MaxSearchLength)
        {
            return Task.FromResult<IActionResult>(BadRequest(new { message = "That search is too long." }));
        }

        return ForwardGetAsync("/api/v1/search", new Dictionary<string, string?>
        {
            ["query"] = query.Trim(),
            ["page"] = ClampPage(page).ToString(CultureInfo.InvariantCulture)
        }, cancellationToken);
    }

    /// <summary>
    /// Proxies an allow-listed Jellyseerr discover category.
    /// </summary>
    /// <param name="category">Category ID.</param>
    /// <param name="page">Page number.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Jellyseerr response.</returns>
    [HttpGet("Discover/{category}")]
    public Task<IActionResult> Discover(string category, [FromQuery] int page = 1, CancellationToken cancellationToken = default)
    {
        var endpoint = category.ToLowerInvariant() switch
        {
            "trending" => "/api/v1/discover/trending",
            "movies" => "/api/v1/discover/movies",
            "upcoming-movies" => "/api/v1/discover/movies/upcoming",
            "tv" or "shows" => "/api/v1/discover/tv",
            "upcoming-tv" or "upcoming-shows" => "/api/v1/discover/tv/upcoming",
            _ => null
        };

        if (endpoint is null)
        {
            return Task.FromResult<IActionResult>(BadRequest(new { message = "Unknown discover category." }));
        }

        var query = new Dictionary<string, string?>
        {
            ["page"] = ClampPage(page).ToString(CultureInfo.InvariantCulture)
        };

        if (!endpoint.Equals("/api/v1/discover/trending", StringComparison.Ordinal))
        {
            AddAllowedDiscoverFilters(query);
        }

        return ForwardGetAsync(endpoint, query, cancellationToken);
    }

    private void AddAllowedDiscoverFilters(IDictionary<string, string?> query)
    {
        foreach (var pair in ControllerContext.HttpContext.Request.Query)
        {
            // Unknown filters, and known ones with values that don't look right, are dropped.
            if (!DiscoverFilterPatterns.TryGetValue(pair.Key, out var pattern))
            {
                continue;
            }

            var value = pair.Value.ToString();
            if (value.Length <= 200 && pattern.IsMatch(value))
            {
                query[pair.Key] = value;
            }
        }
    }

    /// <summary>
    /// Proxies Jellyseerr movie details.
    /// </summary>
    /// <param name="tmdbId">TMDB movie ID.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Jellyseerr response.</returns>
    [HttpGet("Movie/{tmdbId:int}")]
    public Task<IActionResult> Movie(int tmdbId, CancellationToken cancellationToken)
    {
        return ForwardGetAsync($"/api/v1/movie/{tmdbId}", new Dictionary<string, string?>(), cancellationToken);
    }

    /// <summary>
    /// Proxies Jellyseerr TV details.
    /// </summary>
    /// <param name="tmdbId">TMDB TV ID.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Jellyseerr response.</returns>
    [HttpGet("Tv/{tmdbId:int}")]
    public Task<IActionResult> Tv(int tmdbId, CancellationToken cancellationToken)
    {
        return ForwardGetAsync($"/api/v1/tv/{tmdbId}", new Dictionary<string, string?>(), cancellationToken);
    }

    /// <summary>
    /// Proxies Rotten Tomatoes and IMDb ratings for a movie.
    /// </summary>
    /// <param name="tmdbId">TMDB movie ID.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Jellyseerr response.</returns>
    [HttpGet("Movie/{tmdbId:int}/Ratings")]
    public async Task<IActionResult> MovieRatings(int tmdbId, CancellationToken cancellationToken)
    {
        // The combined endpoint has both Rotten Tomatoes and IMDb. Older Jellyseerr versions
        // don't have it, so fall back to the Rotten Tomatoes only one.
        var combined = await ForwardGetAsync($"/api/v1/movie/{tmdbId}/ratingscombined", new Dictionary<string, string?>(), cancellationToken).ConfigureAwait(false);
        if (combined is ContentResult { StatusCode: StatusCodes.Status404NotFound })
        {
            return await ForwardGetAsync($"/api/v1/movie/{tmdbId}/ratings", new Dictionary<string, string?>(), cancellationToken).ConfigureAwait(false);
        }

        return combined;
    }

    /// <summary>
    /// Proxies Rotten Tomatoes ratings for a show.
    /// </summary>
    /// <param name="tmdbId">TMDB TV ID.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Jellyseerr response.</returns>
    [HttpGet("Tv/{tmdbId:int}/Ratings")]
    public Task<IActionResult> TvRatings(int tmdbId, CancellationToken cancellationToken)
    {
        return ForwardGetAsync($"/api/v1/tv/{tmdbId}/ratings", new Dictionary<string, string?>(), cancellationToken);
    }

    /// <summary>
    /// Proxies titles similar to a movie.
    /// </summary>
    /// <param name="tmdbId">TMDB movie ID.</param>
    /// <param name="page">Page number.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Jellyseerr response.</returns>
    [HttpGet("Movie/{tmdbId:int}/Recommendations")]
    public Task<IActionResult> MovieRecommendations(int tmdbId, [FromQuery] int page = 1, CancellationToken cancellationToken = default)
    {
        return ForwardGetAsync($"/api/v1/movie/{tmdbId}/recommendations", PageQuery(page), cancellationToken);
    }

    /// <summary>
    /// Proxies titles similar to a show.
    /// </summary>
    /// <param name="tmdbId">TMDB TV ID.</param>
    /// <param name="page">Page number.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Jellyseerr response.</returns>
    [HttpGet("Tv/{tmdbId:int}/Recommendations")]
    public Task<IActionResult> TvRecommendations(int tmdbId, [FromQuery] int page = 1, CancellationToken cancellationToken = default)
    {
        return ForwardGetAsync($"/api/v1/tv/{tmdbId}/recommendations", PageQuery(page), cancellationToken);
    }

    /// <summary>
    /// Proxies a movie collection, such as every film in a series, with each film's status.
    /// </summary>
    /// <param name="collectionId">TMDB collection ID.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Jellyseerr response.</returns>
    [HttpGet("Collection/{collectionId:int}")]
    public Task<IActionResult> Collection(int collectionId, CancellationToken cancellationToken)
    {
        return ForwardGetAsync($"/api/v1/collection/{collectionId}", new Dictionary<string, string?>(), cancellationToken);
    }

    private static Dictionary<string, string?> PageQuery(int page)
    {
        return new Dictionary<string, string?>
        {
            ["page"] = ClampPage(page).ToString(CultureInfo.InvariantCulture)
        };
    }

    /// <summary>
    /// Submits a sanitized request to Jellyseerr.
    /// </summary>
    /// <param name="request">Request body.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Jellyseerr response.</returns>
    [HttpPost("Request")]
    public async Task<IActionResult> SubmitRequest([FromBody] BridgeRequest request, CancellationToken cancellationToken)
    {
        var config = GetConfig();
        if (!config.EnableRequestSubmission)
        {
            return StatusCode(403, new { message = "Request submission is disabled by the Jellyfin administrator." });
        }

        if (!IsUserAllowed(config))
        {
            return StatusCode(403, new { message = "Your account isn't allowed to request titles. Ask an admin if you think it should be." });
        }

        // Generous enough for requesting a whole film collection at once.
        if (RateLimit("request", 30, TimeSpan.FromMinutes(10)) is IActionResult tooMany)
        {
            return tooMany;
        }

        var validation = ValidateRequest(request, config);
        if (validation is not null)
        {
            return validation;
        }

        // The request goes in under the person asking, so Jellyseerr's per-user approval
        // rules and request limits apply to it.
        var seerrUser = await ResolveSeerrUserAsync(cancellationToken).ConfigureAwait(false);
        if (seerrUser.Id is not int seerrUserId)
        {
            return StatusCode(403, new { message = seerrUser.Error });
        }

        var payload = BuildJellyseerrRequestPayload(request);
        if (!config.AutoApproveRequests)
        {
            return await ForwardPostAsync("/api/v1/request", payload, cancellationToken, seerrUserId).ConfigureAwait(false);
        }

        try
        {
            using var client = CreateClient(seerrUserId);
            using var content = new StringContent(payload.GetRawText(), Encoding.UTF8, "application/json");
            using var response = await client.PostAsync("/api/v1/request", content, cancellationToken).ConfigureAwait(false);
            var body = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
            if (response.IsSuccessStatusCode)
            {
                body = await ApproveIfPendingAsync(body, cancellationToken).ConfigureAwait(false);
            }

            return SeerrResult(response.StatusCode, body, response.Content.Headers.ContentType?.ToString(), "/api/v1/request");
        }
        catch (Exception ex) when (ex is InvalidOperationException or HttpRequestException or TaskCanceledException)
        {
            return JellyseerrFailed(ex, "/api/v1/request");
        }
    }

    /// <summary>
    /// Approves a request Jellyseerr has left waiting for an admin, when the "approve every
    /// request" setting is on. It's done with the admin key (no X-Api-User), the same as an
    /// admin pressing Approve in Jellyseerr, which then sends it to Radarr or Sonarr.
    /// </summary>
    /// <param name="createdRequest">Jellyseerr's answer to creating the request.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The approved request, or the original answer if there was nothing to approve or approving failed.</returns>
    private async Task<string> ApproveIfPendingAsync(string createdRequest, CancellationToken cancellationToken)
    {
        int requestId;
        try
        {
            using var document = JsonDocument.Parse(createdRequest);
            var root = document.RootElement;
            // Jellyseerr's request status 1 means waiting for approval. Anything else (already
            // approved because the user has Auto-Approve, say) is left alone.
            if (root.ValueKind != JsonValueKind.Object
                || !root.TryGetProperty("status", out var status) || !status.TryGetInt32(out var statusValue) || statusValue != 1
                || !root.TryGetProperty("id", out var id) || !id.TryGetInt32(out requestId))
            {
                return createdRequest;
            }
        }
        catch (JsonException)
        {
            return createdRequest;
        }

        try
        {
            using var adminClient = CreateClient();
            using var approve = await adminClient.PostAsync(
                string.Format(CultureInfo.InvariantCulture, "/api/v1/request/{0}/approve", requestId),
                content: null,
                cancellationToken).ConfigureAwait(false);
            if (approve.IsSuccessStatusCode)
            {
                return await approve.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
            }

            _logger.LogWarning("Jellyseerr wouldn't approve request {RequestId} (HTTP {StatusCode}); it's waiting for an admin instead", requestId, (int)approve.StatusCode);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            _logger.LogWarning(ex, "Couldn't approve request {RequestId}; it's waiting for an admin instead", requestId);
        }

        // The request itself went through, so the user still gets a success; it just shows as
        // waiting for approval until someone approves it in Jellyseerr.
        return createdRequest;
    }

    private static PluginConfiguration GetConfig()
    {
        return Plugin.Instance?.Configuration ?? new PluginConfiguration();
    }

    private static Uri? TryCreateBaseUri(PluginConfiguration config)
    {
        return TryCreateBaseUri(config.JellyseerrBaseUrl);
    }

    private static Uri? TryCreateBaseUri(string? baseUrl)
    {
        if (!Uri.TryCreate(baseUrl, UriKind.Absolute, out var uri))
        {
            return null;
        }

        if (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps)
        {
            return null;
        }

        return uri;
    }

    private HttpClient CreateClient(int? asSeerrUser = null)
    {
        var config = GetConfig();
        var baseUri = TryCreateBaseUri(config) ?? throw new InvalidOperationException("Jellyseerr base URL is not configured.");
        if (string.IsNullOrWhiteSpace(config.JellyseerrApiKey))
        {
            throw new InvalidOperationException("Jellyseerr API key is not configured.");
        }

        var client = CreateClient(baseUri, config.JellyseerrApiKey);
        if (asSeerrUser is int seerrUserId)
        {
            // With the admin API key, this makes Jellyseerr treat the call as coming from that user.
            client.DefaultRequestHeaders.Add("X-Api-User", seerrUserId.ToString(CultureInfo.InvariantCulture));
        }

        return client;
    }

    private HttpClient CreateClient(Uri baseUri, string apiKey)
    {
        // The factory hands out a fresh HttpClient each time but reuses the network
        // connections underneath, so making one per call no longer wastes sockets.
        var client = _httpClientFactory.CreateClient(NamedClient.Default);
        client.BaseAddress = baseUri;
        client.Timeout = TimeSpan.FromSeconds(30);
        client.DefaultRequestHeaders.Remove("X-Api-Key");
        client.DefaultRequestHeaders.Add("X-Api-Key", apiKey);
        client.DefaultRequestHeaders.Accept.Clear();
        client.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        return client;
    }

    private async Task<IActionResult> ForwardGetAsync(string path, IReadOnlyDictionary<string, string?> query, CancellationToken cancellationToken, int? asSeerrUser = null)
    {
        try
        {
            using var client = CreateClient(asSeerrUser);
            var url = BuildRelativeUrl(path, query);
            using var response = await client.GetAsync(url, cancellationToken).ConfigureAwait(false);
            return await ProxyResponseAsync(response, cancellationToken).ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is InvalidOperationException or HttpRequestException or TaskCanceledException)
        {
            return JellyseerrFailed(ex, path);
        }
    }

    private async Task<IActionResult> ForwardPostAsync(string path, JsonElement payload, CancellationToken cancellationToken, int? asSeerrUser = null)
    {
        try
        {
            using var client = CreateClient(asSeerrUser);
            using var content = new StringContent(payload.GetRawText(), Encoding.UTF8, "application/json");
            using var response = await client.PostAsync(path, content, cancellationToken).ConfigureAwait(false);
            return await ProxyResponseAsync(response, cancellationToken).ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is InvalidOperationException or HttpRequestException or TaskCanceledException)
        {
            return JellyseerrFailed(ex, path);
        }
    }

    private IActionResult JellyseerrFailed(Exception ex, string path)
    {
        if (ex is InvalidOperationException && GetConfig() is var config && (TryCreateBaseUri(config) is null || string.IsNullOrWhiteSpace(config.JellyseerrApiKey)))
        {
            return StatusCode(502, new { message = "Jellyseerr Bridge isn't set up yet. Ask an admin to add the Jellyseerr URL and API key." });
        }

        if (ex is TaskCanceledException && HttpContext.RequestAborted.IsCancellationRequested)
        {
            // The browser gave up (the user navigated away), so there's no one to tell.
            return StatusCode(499);
        }

        _logger.LogWarning(ex, "Jellyseerr call to {Path} failed", path);
        return StatusCode(502, new { message = JellyseerrUnavailableMessage });
    }

    private async Task<IActionResult> ProxyResponseAsync(HttpResponseMessage response, CancellationToken cancellationToken)
    {
        var body = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
        return SeerrResult(response.StatusCode, body, response.Content.Headers.ContentType?.ToString(), response.RequestMessage?.RequestUri?.AbsolutePath);
    }

    private IActionResult SeerrResult(HttpStatusCode statusCode, string body, string? contentType, string? path)
    {
        if ((int)statusCode >= 500)
        {
            // Jellyseerr's own failures can include internal details, so log them and send
            // users a plain message. Its 4xx answers (already requested, over the limit and
            // so on) are meant for users and pass through as they are.
            _logger.LogWarning(
                "Jellyseerr answered {Path} with HTTP {StatusCode}: {Body}",
                path,
                (int)statusCode,
                body.Length > 500 ? body[..500] : body);
            return StatusCode(502, new { message = JellyseerrUnavailableMessage });
        }

        return new ContentResult
        {
            StatusCode = (int)statusCode,
            // Jellyseerr answers as if an admin were asking, so strip out other people's
            // details and admin-only links before this reaches a browser.
            Content = SeerrResponseSanitizer.Sanitize(body),
            ContentType = contentType ?? "application/json"
        };
    }

    private static string BuildRelativeUrl(string path, IReadOnlyDictionary<string, string?> query)
    {
        if (query.Count == 0)
        {
            return path;
        }

        var queryString = string.Join(
            "&",
            query.Where(pair => !string.IsNullOrWhiteSpace(pair.Value))
                .Select(pair => $"{Uri.EscapeDataString(pair.Key)}={Uri.EscapeDataString(pair.Value!)}"));
        return string.IsNullOrEmpty(queryString) ? path : $"{path}?{queryString}";
    }

    private IActionResult? ValidateRequest(BridgeRequest request, PluginConfiguration config)
    {
        var mediaType = request.MediaType.ToLowerInvariant();
        if (mediaType is not ("movie" or "tv"))
        {
            return BadRequest(new { message = "mediaType must be movie or tv." });
        }

        if (request.MediaId <= 0)
        {
            return BadRequest(new { message = "mediaId must be a positive TMDB ID." });
        }

        if (request.Is4K && !config.Enable4KRequests)
        {
            return StatusCode(403, new { message = "4K requests are disabled." });
        }

        if (mediaType == "movie")
        {
            return null;
        }

        if (request.Seasons is null)
        {
            return null;
        }

        var seasons = request.Seasons.Value;
        if (seasons.ValueKind == JsonValueKind.String && seasons.GetString() == "all")
        {
            return null;
        }

        if (seasons.ValueKind == JsonValueKind.Array && seasons.EnumerateArray().All(item => item.ValueKind == JsonValueKind.Number && item.TryGetInt32(out var season) && season >= 0))
        {
            return null;
        }

        return BadRequest(new { message = "TV seasons must be omitted, \"all\", or an array of non-negative season numbers." });
    }

    private bool IsUserAllowed(PluginConfiguration config)
    {
        if (config.AllowedUserIds.Length == 0)
        {
            return true;
        }

        // Compare as IDs rather than text, so an ID pasted with or without dashes still matches.
        var userId = CurrentJellyfinUserId();
        return userId is not null && config.AllowedUserIds.Select(NormalizeUserId).Contains(userId, StringComparer.OrdinalIgnoreCase);
    }

    private static JsonElement BuildJellyseerrRequestPayload(BridgeRequest request)
    {
        var mediaType = request.MediaType.ToLowerInvariant() == "tv" ? "tv" : "movie";
        var payload = new Dictionary<string, object?>
        {
            ["mediaType"] = mediaType,
            ["mediaId"] = request.MediaId,
            ["is4k"] = request.Is4K
        };

        if (mediaType == "tv")
        {
            payload["seasons"] = request.Seasons is null ? "all" : JsonSerializer.Deserialize<object>(request.Seasons.Value.GetRawText(), JsonOptions);
        }

        // No server, profile or folder here: Jellyseerr uses its default Radarr or Sonarr server
        // when none is given, and it doesn't let regular users pick those anyway.
        return JsonSerializer.SerializeToElement(payload, JsonOptions);
    }

    private static bool ReadBool(JsonElement element, string property)
    {
        return element.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.True;
    }

    private static string? ReadString(JsonElement element, string property)
    {
        return element.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;
    }

    private IActionResult EmbeddedFile(string resourceSuffix, string contentType)
    {
        Response.Headers.CacheControl = "no-store, max-age=0";
        Response.Headers.XContentTypeOptions = "nosniff";
        Response.Headers.Pragma = "no-cache";
        Response.Headers.Expires = "0";

        var assembly = typeof(JellyseerrBridgeController).Assembly;
        var resource = assembly.GetManifestResourceNames()
            .FirstOrDefault(name => name.EndsWith(resourceSuffix, StringComparison.Ordinal));
        if (resource is null)
        {
            return NotFound();
        }

        using var stream = assembly.GetManifestResourceStream(resource);
        if (stream is null)
        {
            return NotFound();
        }

        using var reader = new StreamReader(stream);
        return Content(reader.ReadToEnd(), contentType);
    }
}
