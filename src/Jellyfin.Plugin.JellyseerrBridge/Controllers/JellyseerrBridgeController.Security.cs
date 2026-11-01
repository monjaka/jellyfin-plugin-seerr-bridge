using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.JellyseerrBridge.Controllers;

/// <summary>
/// Limits and checks that keep one account (or a stolen token) from flooding Jellyseerr, and
/// keep odd input from being passed through to it.
/// </summary>
public sealed partial class JellyseerrBridgeController
{
    /// <summary>
    /// What users see when Jellyseerr can't be reached or falls over. The real reason, which can
    /// include internal hostnames and ports, goes to the Jellyfin log instead.
    /// </summary>
    private const string JellyseerrUnavailableMessage = "Jellyseerr couldn't be reached right now. If this keeps happening, ask an admin to check the Jellyseerr Bridge settings.";

    // TMDB never has more than 500 pages of results, and nobody scrolls that far anyway.
    private const int MaxPage = 500;

    private const int MaxSearchLength = 200;

    private static readonly ConcurrentDictionary<string, Queue<DateTimeOffset>> RecentActions = new(StringComparer.Ordinal);

    // Discover filters are passed through to Jellyseerr, so each one has to look like what the
    // request page actually sends.
    private static readonly Dictionary<string, Regex> DiscoverFilterPatterns = new(StringComparer.OrdinalIgnoreCase)
    {
        ["sortBy"] = new Regex("^[a-z_]{1,40}\\.(asc|desc)$", RegexOptions.CultureInvariant),
        ["primaryReleaseDateGte"] = DatePattern(),
        ["primaryReleaseDateLte"] = DatePattern(),
        ["firstAirDateGte"] = DatePattern(),
        ["firstAirDateLte"] = DatePattern(),
        ["voteAverageGte"] = new Regex("^\\d{1,2}(\\.\\d{1,2})?$", RegexOptions.CultureInvariant),
        ["voteAverageLte"] = new Regex("^\\d{1,2}(\\.\\d{1,2})?$", RegexOptions.CultureInvariant),
        ["watchRegion"] = new Regex("^[A-Z]{2}$", RegexOptions.CultureInvariant),
        ["watchProviders"] = new Regex("^\\d{1,6}(\\|\\d{1,6}){0,19}$", RegexOptions.CultureInvariant)
    };

    private static Regex DatePattern() => new("^\\d{4}-\\d{2}-\\d{2}$", RegexOptions.CultureInvariant);

    private static int ClampPage(int page) => Math.Clamp(page, 1, MaxPage);

    /// <summary>
    /// Counts an action against the signed-in user and says whether they've gone over the limit.
    /// The window slides, so the limit frees up gradually rather than all at once.
    /// </summary>
    /// <param name="action">A short name for what's being limited, like "request".</param>
    /// <param name="limit">How many are allowed inside the window.</param>
    /// <param name="window">How far back to count.</param>
    /// <returns>A 429 response to send back, or null if the action is allowed.</returns>
    private IActionResult? RateLimit(string action, int limit, TimeSpan window)
    {
        var key = action + ":" + (CurrentJellyfinUserId() ?? "unknown");
        var now = DateTimeOffset.UtcNow;
        var recent = RecentActions.GetOrAdd(key, _ => new Queue<DateTimeOffset>());

        lock (recent)
        {
            while (recent.Count > 0 && now - recent.Peek() > window)
            {
                recent.Dequeue();
            }

            if (recent.Count >= limit)
            {
                var wait = window - (now - recent.Peek());
                var minutes = Math.Max(1, (int)Math.Ceiling(wait.TotalMinutes));
                Response.Headers.RetryAfter = ((int)Math.Ceiling(wait.TotalSeconds)).ToString(System.Globalization.CultureInfo.InvariantCulture);
                return StatusCode(
                    StatusCodes.Status429TooManyRequests,
                    new { message = $"That's a lot in a short time. Try again in about {minutes} minute{(minutes == 1 ? string.Empty : "s")}." });
            }

            recent.Enqueue(now);
            return null;
        }
    }

    /// <summary>
    /// Headers for the request page. It runs on Jellyfin's own site and can see the user's
    /// Jellyfin sign-in, so if a bug ever let someone slip script into it, these stop that
    /// script from loading anything or sending data anywhere but Jellyfin.
    /// </summary>
    private void AddPageSecurityHeaders()
    {
        Response.Headers.ContentSecurityPolicy =
            "default-src 'none'; " +
            "script-src 'self'; " +
            // The page has one style block and sets progress bar widths inline.
            "style-src 'self' 'unsafe-inline'; " +
            "img-src 'self' https://image.tmdb.org data:; " +
            "connect-src 'self'; " +
            "base-uri 'none'; " +
            "form-action 'self'; " +
            "frame-ancestors 'self'";
        Response.Headers.XContentTypeOptions = "nosniff";
        Response.Headers["Referrer-Policy"] = "same-origin";
        Response.Headers.XFrameOptions = "SAMEORIGIN";
    }
}
