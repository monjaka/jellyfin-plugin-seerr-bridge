using System;
using System.IO;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.Extensions.Logging;
using Microsoft.Net.Http.Headers;

namespace Jellyfin.Plugin.JellyseerrBridge.WebInjection;

/// <summary>
/// Adds the IndexHtmlInjectionMiddleware to the very front of Jellyfin's request pipeline.
/// </summary>
public sealed class IndexHtmlInjectionStartupFilter : IStartupFilter
{
    /// <inheritdoc />
    public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next)
    {
        return app =>
        {
            app.UseMiddleware<IndexHtmlInjectionMiddleware>();
            next(app);
        };
    }
}

/// <summary>
/// Adds the Request tab loader script to Jellyfin Web's index.html as it's sent to the browser.
/// </summary>
/// <remarks>
/// The file on disk is never touched, so this works in Docker (where the web files are
/// read-only and get replaced on every image update) and needs no other plugins.
/// </remarks>
public sealed class IndexHtmlInjectionMiddleware
{
    private const string LoaderPath = "/JellyseerrBridge/Assets/request-entry.js";

    private static int _loggedOnce;

    private readonly RequestDelegate _next;
    private readonly ILogger<IndexHtmlInjectionMiddleware> _logger;

    /// <summary>
    /// Initializes a new instance of the <see cref="IndexHtmlInjectionMiddleware"/> class.
    /// </summary>
    /// <param name="next">The next middleware in the pipeline.</param>
    /// <param name="logger">Logger.</param>
    public IndexHtmlInjectionMiddleware(RequestDelegate next, ILogger<IndexHtmlInjectionMiddleware> logger)
    {
        _next = next;
        _logger = logger;
    }

    /// <summary>
    /// Handles a request, editing the response only when it's Jellyfin Web's index page.
    /// </summary>
    /// <param name="context">The HTTP context.</param>
    /// <returns>A task that completes when the response has been written.</returns>
    public async Task InvokeAsync(HttpContext context)
    {
        var webRoot = WebRootPrefix(context.Request);
        if (webRoot is null || !HttpMethods.IsGet(context.Request.Method))
        {
            await _next(context).ConfigureAwait(false);
            return;
        }

        // Ask the rest of the pipeline for a plain, full copy of the page. A compressed
        // body can't be edited, and a 304 Not Modified has no body to edit at all.
        context.Request.Headers.Remove(HeaderNames.AcceptEncoding);
        context.Request.Headers.Remove(HeaderNames.IfNoneMatch);
        context.Request.Headers.Remove(HeaderNames.IfModifiedSince);

        // Jellyfin serves index.html with the static file middleware, which can send the file
        // straight to the socket. Swapping the body feature (not just Response.Body) makes it
        // write into our buffer instead.
        var originalFeature = context.Features.Get<IHttpResponseBodyFeature>()!;
        await using var buffer = new MemoryStream();
        context.Features.Set<IHttpResponseBodyFeature>(new StreamResponseBodyFeature(buffer, originalFeature));

        try
        {
            await _next(context).ConfigureAwait(false);
        }
        finally
        {
            context.Features.Set(originalFeature);
        }

        var cancellationToken = context.RequestAborted;
        buffer.Position = 0;

        var isHtml = context.Response.StatusCode == StatusCodes.Status200OK
            && (context.Response.ContentType?.StartsWith("text/html", StringComparison.OrdinalIgnoreCase) ?? false);

        if (isHtml)
        {
            using var reader = new StreamReader(buffer, Encoding.UTF8, detectEncodingFromByteOrderMarks: true, leaveOpen: true);
            var html = await reader.ReadToEndAsync(cancellationToken).ConfigureAwait(false);
            var updated = AddLoaderTag(html, webRoot);

            if (updated is not null)
            {
                var bytes = Encoding.UTF8.GetBytes(updated);
                context.Response.ContentLength = bytes.Length;
                // The original ETag described the unedited file, so it no longer applies.
                context.Response.Headers.Remove(HeaderNames.ETag);
                context.Response.Headers.CacheControl = "no-cache";

                if (Interlocked.Exchange(ref _loggedOnce, 1) == 0)
                {
                    _logger.LogInformation("Jellyseerr Bridge added its Request tab loader to Jellyfin Web");
                }

                await originalFeature.Stream.WriteAsync(bytes, cancellationToken).ConfigureAwait(false);
                return;
            }

            buffer.Position = 0;
        }

        await buffer.CopyToAsync(originalFeature.Stream, cancellationToken).ConfigureAwait(false);
    }

    /// <summary>
    /// Works out whether this is a request for Jellyfin Web's index page and, if so,
    /// returns everything in front of "/web" so a server base URL like "/jellyfin" is kept.
    /// </summary>
    private static string? WebRootPrefix(HttpRequest request)
    {
        var path = (request.PathBase + request.Path).Value;
        if (string.IsNullOrEmpty(path))
        {
            return null;
        }

        var trimmed = path.TrimEnd('/');
        foreach (var ending in new[] { "/web", "/web/index.html" })
        {
            if (trimmed.EndsWith(ending, StringComparison.OrdinalIgnoreCase))
            {
                return trimmed[..^ending.Length];
            }
        }

        return null;
    }

    /// <summary>
    /// Puts the loader script tag just before the closing body tag. Returns null when the
    /// page already loads the script (for example from an older manual index.html edit).
    /// </summary>
    private static string? AddLoaderTag(string html, string webRoot)
    {
        if (html.Contains(LoaderPath, StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        var version = typeof(Plugin).Assembly.GetName().Version?.ToString() ?? "0";
        var tag = $"<script defer src=\"{webRoot}{LoaderPath}?v={version}\"></script>";

        var bodyEnd = html.LastIndexOf("</body>", StringComparison.OrdinalIgnoreCase);
        return bodyEnd >= 0
            ? html.Insert(bodyEnd, tag)
            : html + tag;
    }
}
