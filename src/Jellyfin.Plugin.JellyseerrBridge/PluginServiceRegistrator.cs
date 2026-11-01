using Jellyfin.Plugin.JellyseerrBridge.WebInjection;
using MediaBrowser.Controller;
using MediaBrowser.Controller.Plugins;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.DependencyInjection;

namespace Jellyfin.Plugin.JellyseerrBridge;

/// <summary>
/// Registers the plugin's services with Jellyfin when the server starts.
/// </summary>
public sealed class PluginServiceRegistrator : IPluginServiceRegistrator
{
    /// <inheritdoc />
    public void RegisterServices(IServiceCollection serviceCollection, IServerApplicationHost applicationHost)
    {
        // Lets the plugin add the Request tab loader to Jellyfin Web itself, so admins
        // don't have to edit index.html or install a script injector plugin.
        serviceCollection.AddTransient<IStartupFilter, IndexHtmlInjectionStartupFilter>();
    }
}
