using MediaBrowser.Model.Plugins;

namespace Jellyfin.Plugin.JellyseerrBridge.Configuration;

/// <summary>
/// Jellyseerr Bridge plugin configuration.
/// </summary>
public sealed class PluginConfiguration : BasePluginConfiguration
{
    /// <summary>
    /// Gets or sets the Jellyseerr base URL, for example http://jellyseerr:5055.
    /// </summary>
    public string JellyseerrBaseUrl { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the Jellyseerr API key. This value is never returned by public plugin endpoints.
    /// </summary>
    public string JellyseerrApiKey { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets a value indicating whether request submission is enabled.
    /// </summary>
    public bool EnableRequestSubmission { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether 4K requests are allowed.
    /// </summary>
    public bool Enable4KRequests { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether the plugin approves every request itself, so
    /// nobody waits for an admin even if their Jellyseerr account doesn't have Auto-Approve.
    /// Request limits are still checked by Jellyseerr when the request is made.
    /// </summary>
    public bool AutoApproveRequests { get; set; }

    /// <summary>
    /// Gets or sets the Jellyfin user IDs allowed to submit requests. Empty allows any authenticated Jellyfin user.
    /// </summary>
    public string[] AllowedUserIds { get; set; } = [];

    /// <summary>
    /// Gets or sets a value indicating whether Jellyfin users without a Jellyseerr account are
    /// added to Jellyseerr automatically the first time they request something. When off, an
    /// admin has to import them in Jellyseerr first.
    /// </summary>
    public bool AutoAddUsersToJellyseerr { get; set; } = true;
}
