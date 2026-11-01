(() => {
  "use strict";

  // The plugin now adds this script to Jellyfin Web on its own. If an older manual
  // index.html edit or an injector plugin loads it as well, only the first copy runs.
  if (window.__jellyseerrBridgeEntryLoaded) return;
  window.__jellyseerrBridgeEntryLoaded = true;

  const REQUEST_URL = "/JellyseerrBridge/Page?v=0.3.1.0";
  const STYLE_ID = "jellyseerr-bridge-request-entry-style";

  // Same plus-in-a-circle icon as the side menu entry, drawn as an SVG for the
  // avatar menu because the Modern layout may not load the icon font.
  const REQUEST_ICON_SVG = '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false" fill="currentColor"><path d="M13 7h-2v4H7v2h4v4h2v-4h4v-2h-4V7zm-1-5C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"/></svg>';

  function textOf(node) {
    return [
      node?.textContent,
      node?.getAttribute?.("aria-label"),
      node?.getAttribute?.("title"),
      node?.getAttribute?.("data-title")
    ].filter(Boolean).join(" ").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = ".jellyseerr-bridge-request-menu-item{align-items:center;color:inherit;display:flex!important;gap:1rem;min-height:3rem;padding:.75rem 1.25rem;text-decoration:none}.jellyseerr-bridge-request-menu-item:hover,.jellyseerr-bridge-request-menu-item:focus,.jellyseerr-bridge-request-tab:hover,.jellyseerr-bridge-request-tab:focus{color:#00a4dc;text-decoration:none}.jellyseerr-bridge-request-menu-icon{align-items:center;display:inline-flex;font-size:1.45rem;justify-content:center;line-height:1;min-width:1.5rem}.jellyseerr-bridge-request-menu-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.jellyseerr-bridge-request-tab{align-items:center;color:inherit;display:inline-flex;text-decoration:none}.jellyseerr-bridge-user-menu-item{align-items:center;color:inherit;display:flex;gap:1rem;text-decoration:none}.jellyseerr-bridge-user-menu-item svg{opacity:.7}";
    style.textContent += SEASON_DIALOG_CSS;
    document.head.appendChild(style);
  }

  function controlsIn(container) {
    return Array.from(container.querySelectorAll("a, button, [role='button'], [role='menuitem'], [role='link'], [role='tab']"));
  }

  function openRequestPage(event) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    window.location.assign(REQUEST_URL);
  }

  function wireLink(link) {
    link.href = REQUEST_URL;
    link.addEventListener("click", openRequestPage, true);
    return link;
  }

  function sideMenuContainers() {
    const selectors = [
      ".mainDrawer-scrollContainer",
      ".mainDrawer .scrollContainer",
      ".drawerContent",
      ".navMenu",
      ".MuiDrawer-paper"
    ];
    const found = new Set();
    for (const selector of selectors) {
      for (const candidate of document.querySelectorAll(selector)) {
        if (candidate.classList?.contains("mainDrawerHandle")) continue;
        const labels = controlsIn(candidate).map(textOf);
        const hasNormalNav = labels.includes("home")
          || labels.includes("favorites")
          || labels.includes("favourites")
          || labels.some((label) => label.includes("home"));
        if (hasNormalNav) found.add(candidate);
      }
    }
    return Array.from(found);
  }

  function isDrawerElement(node) {
    return Boolean(node?.closest?.(".mainDrawer,.mainDrawer-scrollContainer,.drawerContent,.MuiDrawer-paper"));
  }

  function labelMatches(node, labels) {
    const label = textOf(node);
    return labels.some((value) => label === value || label.includes(value));
  }

  function topNavContainers() {
    const found = new Set();
    const selectors = [
      ".sectionTabs",
      ".emby-tabs",
      ".tabs",
      ".headerTabs",
      ".viewMenuBar",
      ".skinHeader .tabs",
      // The Modern layout's Home/Favorites tabs are an MUI tab list.
      ".MuiTabs-flexContainer",
      "[role='tablist']"
    ];

    for (const selector of selectors) {
      for (const candidate of document.querySelectorAll(selector)) {
        if (isDrawerElement(candidate)) continue;
        const controls = controlsIn(candidate);
        const hasHome = controls.some((item) => labelMatches(item, ["home"]));
        const hasFavorites = controls.some((item) => labelMatches(item, ["favorites", "favourites"]));
        if (hasHome && hasFavorites) found.add(candidate);
      }
    }

    for (const home of controlsIn(document).filter((item) => !isDrawerElement(item) && labelMatches(item, ["home"]))) {
      let candidate = home.parentElement;
      for (let depth = 0; candidate && depth < 4; depth += 1, candidate = candidate.parentElement) {
        const controls = controlsIn(candidate);
        const hasFavorites = controls.some((item) => labelMatches(item, ["favorites", "favourites"]));
        if (hasFavorites && controls.length <= 12) {
          found.add(candidate);
          break;
        }
      }
    }

    return Array.from(found).sort((left, right) => controlsIn(left).length - controlsIn(right).length);
  }

  function createMenuItem(reference) {
    const link = document.createElement("a");
    link.className = "jellyseerr-bridge-request-menu-item";
    link.setAttribute("aria-label", "Requests");
    wireLink(link);

    const icon = document.createElement("span");
    icon.className = "material-icons jellyseerr-bridge-request-menu-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "add_circle_outline";

    const label = document.createElement("span");
    label.className = "jellyseerr-bridge-request-menu-label";
    label.textContent = "Requests";

    link.append(icon, label);

    const referenceClass = reference?.getAttribute("class");
    if (referenceClass) link.setAttribute("class", `${referenceClass} jellyseerr-bridge-request-menu-item`);
    const referenceRole = reference?.getAttribute("role");
    if (referenceRole) link.setAttribute("role", referenceRole);

    return link;
  }

  function createTopTab(reference) {
    const tag = reference?.tagName?.toLowerCase() === "button" ? "button" : "a";
    const link = document.createElement(tag);
    link.className = "jellyseerr-bridge-request-tab";
    link.textContent = "Request";
    link.setAttribute("aria-label", "Request");
    link.setAttribute("data-jellyseerr-bridge", "request-tab");
    if (tag === "button") link.type = "button";
    wireLink(link);

    const referenceClass = reference?.getAttribute("class");
    if (referenceClass) link.setAttribute("class", `${referenceClass} jellyseerr-bridge-request-tab`);
    const referenceRole = reference?.getAttribute("role");
    if (referenceRole) link.setAttribute("role", referenceRole);
    const referenceTabIndex = reference?.getAttribute("tabindex");
    if (referenceTabIndex) link.setAttribute("tabindex", referenceTabIndex);
    link.classList.remove("selected", "active", "is-active", "current", "Mui-selected");
    // MUI tabs mark the current tab with aria-selected, so ours has to say it isn't.
    if (referenceRole === "tab") {
      link.setAttribute("aria-selected", "false");
      link.setAttribute("tabindex", "-1");
    } else {
      link.removeAttribute("aria-selected");
    }

    return link;
  }

  function insertTopTab() {
    ensureStyle();
    const existingTabs = Array.from(document.querySelectorAll(".jellyseerr-bridge-request-tab"));
    existingTabs.slice(1).forEach((node) => node.remove());
    if (existingTabs.length > 0) return;

    for (const container of topNavContainers()) {
      const controls = controlsIn(container);
      const after = controls.find((item) => /^(favorites|favourites)$/i.test(textOf(item)))
        || controls.find((item) => /^home$/i.test(textOf(item)) || textOf(item).includes("home"));
      if (!after) continue;
      const link = createTopTab(after);
      after.insertAdjacentElement("afterend", link);
      return;
    }
  }

  function insertSideMenuItem() {
    ensureStyle();

    for (const container of sideMenuContainers()) {
      if (container.querySelector(".jellyseerr-bridge-request-menu-item")) continue;
      const controls = controlsIn(container);
      const after = controls.find((item) => /^(favorites|favourites)$/i.test(textOf(item)))
        || controls.find((item) => /^home$/i.test(textOf(item)) || textOf(item).includes("home"))
        || controls[0];
      if (!after) continue;
      const link = createMenuItem(after);
      if (after.parentElement === container) after.insertAdjacentElement("afterend", link);
      else after.parentElement?.insertAdjacentElement("afterend", link);
    }
  }

  // The Modern layout (default in Jellyfin 12) has no side drawer on desktop,
  // and the Home/Favorites tabs only exist on the home page. The avatar menu
  // entry means Requests can still be reached from every other page.

  function userMenuLists() {
    const lists = document.querySelectorAll(".MuiPopover-root ul[role='menu'], .MuiMenu-root ul[role='menu']");
    return Array.from(lists).filter((list) => {
      const labels = Array.from(list.querySelectorAll("[role='menuitem']")).map(textOf);
      return labels.some((label) => label.includes("sign out") || label.includes("log out") || label.includes("logout"));
    });
  }

  function insertUserMenuItem() {
    for (const list of userMenuLists()) {
      if (list.querySelector(".jellyseerr-bridge-user-menu-item")) continue;

      const items = Array.from(list.querySelectorAll("[role='menuitem']"));
      const signOut = items.find((item) => /sign out|log ?out/.test(textOf(item)));
      const reference = items.find((item) => item !== signOut) || items[0];

      ensureStyle();
      const link = document.createElement("a");
      link.setAttribute("role", "menuitem");
      link.setAttribute("tabindex", "-1");
      // Borrow the MUI classes from a real menu item so spacing and hover match.
      link.className = `${reference?.getAttribute("class") || ""} jellyseerr-bridge-user-menu-item`.trim();
      link.innerHTML = `${REQUEST_ICON_SVG}<span>Requests</span>`;
      wireLink(link);

      if (signOut && signOut.parentElement === list) list.insertBefore(link, signOut);
      else list.appendChild(link);
    }
  }

  // ---------------------------------------------------------------------------
  // "Request seasons" on Jellyfin's own show pages.
  //
  // Jellyseerr knows every season a show has and which ones are already requested.
  // Jellyfin knows which episodes are actually on disk. Using both means seasons show up
  // correctly even if Jellyseerr hasn't scanned the library recently.
  // ---------------------------------------------------------------------------

  const SEASONS_ICON_SVG = '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false" fill="currentColor"><path d="M14 10H2v2h12v-2zm0-4H2v2h12V6zm4 8v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zM2 16h8v-2H2v2z"/></svg>';

  const SEASON_DIALOG_CSS = ".jellyseerr-bridge-seasons-button svg{height:1.5em;width:1.5em}.jsb-backdrop{align-items:center;background:rgba(0,0,0,.6);display:flex;inset:0;justify-content:center;padding:1rem;position:fixed;z-index:100000}.jsb-dialog{background:#202020;border-radius:.5rem;box-shadow:0 10px 40px rgba(0,0,0,.6);color:#fff;display:grid;gap:.9rem;max-height:90vh;max-width:32rem;overflow:auto;padding:1.25rem;width:100%}.jsb-dialog h2{font-size:1.2rem;margin:0}.jsb-dialog-hint{color:rgba(255,255,255,.7);font-size:.9rem;margin:0}.jsb-season-list{display:grid;gap:.35rem}.jsb-season-row{align-items:center;border-radius:.35rem;cursor:pointer;display:grid;gap:.75rem;grid-template-columns:auto 1fr auto;padding:.5rem .6rem}.jsb-season-row:hover{background:rgba(255,255,255,.06)}.jsb-season-row.is-disabled{cursor:default;opacity:.55}.jsb-season-row input{accent-color:#00a4dc;height:1.1rem;width:1.1rem}.jsb-season-state{color:rgba(255,255,255,.7);font-size:.85rem;text-align:right}.jsb-dialog-message{font-size:.9rem;min-height:1.2em}.jsb-dialog-message.is-error{color:#ff7b7b}.jsb-dialog-message.is-success{color:#7bd88f}.jsb-dialog-message a{color:#00a4dc}.jsb-dialog-actions{display:flex;flex-wrap:wrap;gap:.5rem}.jsb-dialog-actions .jsb-spacer{flex:1}.jsb-dialog button{background:rgba(255,255,255,.12);border:0;border-radius:.35rem;color:inherit;cursor:pointer;font:inherit;padding:.55rem .9rem}.jsb-dialog button.jsb-primary{background:#00a4dc;color:#061018;font-weight:700}.jsb-dialog button:disabled{cursor:default;opacity:.5}";

  // How long a show's season list is reused before it's fetched again.
  const SEASON_CACHE_MS = 60000;
  const seriesCache = new Map();

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  }

  // Everything in front of "/web", so a server base URL like "/jellyfin" is kept.
  function serverRoot() {
    const index = location.pathname.toLowerCase().lastIndexOf("/web");
    return index >= 0 ? location.pathname.slice(0, index) : "";
  }

  function session() {
    try {
      const api = window.ApiClient;
      const token = api?.accessToken?.();
      const userId = api?.getCurrentUserId?.();
      if (token && userId) return { token, userId };
    } catch {
      // Fall through to the stored credentials.
    }
    try {
      // Only this server's token: if Jellyfin Web remembers several servers, never send another
      // server's token here. With just one saved server, it's this one.
      const servers = (JSON.parse(localStorage.getItem("jellyfin_credentials") || "{}").Servers || [])
        .filter((entry) => entry.AccessToken && entry.UserId);
      const isThisServer = (address) => {
        try {
          return Boolean(address) && new URL(address).origin === location.origin;
        } catch {
          return false;
        }
      };
      const server = servers.find((entry) => [entry.ManualAddress, entry.LocalAddress, entry.RemoteAddress].some(isThisServer))
        || (servers.length === 1 ? servers[0] : null);
      return server ? { token: server.AccessToken, userId: server.UserId } : null;
    } catch {
      return null;
    }
  }

  async function callServer(path, options = {}) {
    const auth = session();
    if (!auth) throw new Error("You're not signed in to Jellyfin.");

    const response = await fetch(`${serverRoot()}${path}`, {
      ...options,
      cache: "no-store",
      headers: {
        ...(options.headers || {}),
        Authorization: `MediaBrowser Token="${auth.token}"`
      }
    });
    const text = await response.text();
    if (!response.ok) {
      let message = `${response.status} ${response.statusText}`;
      try {
        message = JSON.parse(text).message || message;
      } catch {
        // Not JSON, keep the status line.
      }
      throw new Error(message);
    }
    return text ? JSON.parse(text) : null;
  }

  function detailsItemId() {
    const match = location.hash.match(/^#!?\/details\?(.*)$/);
    return match ? new URLSearchParams(match[1]).get("id") : null;
  }

  // Jellyfin keeps old pages in the DOM and hides them, so only the visible one counts.
  function detailButtonContainer() {
    return Array.from(document.querySelectorAll(".mainDetailButtons, .detailButtons"))
      .find((element) => element.offsetParent !== null) || null;
  }

  async function loadSeriesInfo(itemId) {
    const auth = session();
    if (!auth) return null;

    const item = await callServer(`/Items/${encodeURIComponent(itemId)}?userId=${encodeURIComponent(auth.userId)}`);
    if (item?.Type !== "Series") return null;

    const tmdbId = Number(item.ProviderIds?.Tmdb || item.ProviderIds?.tmdb);
    if (!tmdbId) return null;

    const [status, show, episodes] = await Promise.all([
      callServer("/JellyseerrBridge/Status").catch(() => null),
      callServer(`/JellyseerrBridge/Tv/${tmdbId}`),
      callServer(`/Shows/${encodeURIComponent(itemId)}/Episodes?userId=${encodeURIComponent(auth.userId)}&isMissing=false`)
        .catch(() => ({ Items: [] }))
    ]);
    if (!status?.isConfigured || !status.requestSubmissionEnabled) return null;

    return buildSeasonList(tmdbId, item.Name || show?.name || "this show", show, episodes?.Items || []);
  }

  function buildSeasonList(tmdbId, showName, show, episodes) {
    const episodesOnDisk = new Map();
    for (const episode of episodes) {
      if (episode.LocationType === "Virtual") continue;
      const seasonNumber = Number(episode.ParentIndexNumber);
      if (seasonNumber > 0) episodesOnDisk.set(seasonNumber, (episodesOnDisk.get(seasonNumber) || 0) + 1);
    }

    const seerrSeasons = show?.mediaInfo?.seasons || [];
    const downloads = show?.mediaInfo?.downloadStatus || [];
    const today = new Date().toISOString().slice(0, 10);

    const seasons = (show?.seasons || [])
      .filter((season) => Number(season.seasonNumber) > 0)
      .map((season) => {
        const number = Number(season.seasonNumber);
        const total = Number(season.episodeCount) || 0;
        const onDisk = episodesOnDisk.get(number) || 0;
        // Jellyseerr's season status: 2 waiting for approval, 3 approved, 5 available.
        const seerrStatus = seerrSeasons.find((entry) => Number(entry.seasonNumber) === number)?.status;
        const downloading = downloads.some((download) => Number(download.episode?.seasonNumber) === number);
        const aired = Boolean(season.airDate) && season.airDate <= today;

        let state = "missing";
        let label = "Missing";
        if (seerrStatus === 5 || (total > 0 && onDisk >= total)) {
          state = "have";
          label = "In library";
        } else if (downloading) {
          state = "busy";
          label = "Downloading";
        } else if (seerrStatus === 2) {
          state = "busy";
          label = "Waiting for approval";
        } else if (seerrStatus === 3) {
          state = "busy";
          label = "Requested";
        } else if (onDisk > 0) {
          label = `Partly in library (${onDisk} of ${total || "?"} episodes)`;
        } else if (!aired) {
          state = "upcoming";
          label = "Not aired yet";
        }

        return { number, name: season.name || `Season ${number}`, state, label };
      });

    return { tmdbId, showName, seasons };
  }

  function requestableSeasons(info) {
    return (info?.seasons || []).filter((season) => season.state === "missing" || season.state === "upcoming");
  }

  function cachedSeriesInfo(itemId) {
    let entry = seriesCache.get(itemId);
    if (!entry || (!entry.loading && Date.now() - entry.time > SEASON_CACHE_MS)) {
      entry = { time: Date.now(), loading: true, value: null };
      seriesCache.set(itemId, entry);
      loadSeriesInfo(itemId)
        .then((value) => { entry.value = value; })
        .catch(() => { entry.value = null; })
        .finally(() => {
          entry.loading = false;
          entry.time = Date.now();
          insertEntries();
        });
    }
    return entry.loading ? undefined : entry.value;
  }

  function insertSeasonsButton() {
    const itemId = detailsItemId();
    const container = itemId ? detailButtonContainer() : null;

    for (const button of document.querySelectorAll(".jellyseerr-bridge-seasons-button")) {
      if (button.dataset.itemId !== itemId || button.parentElement !== container) button.remove();
    }
    if (!container || container.querySelector(".jellyseerr-bridge-seasons-button")) return;

    const info = cachedSeriesInfo(itemId);
    if (!info || !requestableSeasons(info).length) return;

    ensureStyle();
    const missing = info.seasons.filter((season) => season.state === "missing").length;
    const label = missing ? `Request missing seasons (${missing})` : "Request seasons";

    // Borrow the look of Jellyfin's own detail buttons (Play, Favorite and so on), but only
    // the styling classes. Classes like btnPlay have behaviour attached in Jellyfin Web.
    const styling = ["button-flat", "detailButton", "emby-button", "paper-icon-button-light"];
    const referenceClasses = Array.from(container.querySelector("button")?.classList || []);
    const borrowed = referenceClasses.filter((name) => styling.includes(name));
    const button = document.createElement("button");
    button.type = "button";
    button.className = `${(borrowed.length ? borrowed : ["button-flat", "detailButton"]).join(" ")} jellyseerr-bridge-seasons-button`;
    button.dataset.itemId = itemId;
    button.title = label;
    button.setAttribute("aria-label", label);
    button.innerHTML = `<div class="detailButton-content">${SEASONS_ICON_SVG}</div>`;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openSeasonDialog(itemId);
    });
    container.appendChild(button);
  }

  function closeSeasonDialog() {
    document.querySelector(".jsb-backdrop")?.remove();
    document.removeEventListener("keydown", onDialogKey, true);
  }

  function onDialogKey(event) {
    if (event.key === "Escape") {
      event.stopPropagation();
      closeSeasonDialog();
    }
  }

  async function openSeasonDialog(itemId) {
    closeSeasonDialog();
    ensureStyle();

    const backdrop = document.createElement("div");
    backdrop.className = "jsb-backdrop";
    backdrop.innerHTML = '<div class="jsb-dialog" role="dialog" aria-modal="true" aria-labelledby="jsb-dialog-title"><h2 id="jsb-dialog-title">Request seasons</h2><p class="jsb-dialog-hint">Checking which seasons you have...</p></div>';
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) closeSeasonDialog();
    });
    document.body.appendChild(backdrop);
    document.addEventListener("keydown", onDialogKey, true);

    // Always fetch fresh here, since the button may have been drawn a while ago.
    let info;
    try {
      info = await loadSeriesInfo(itemId);
      seriesCache.set(itemId, { time: Date.now(), loading: false, value: info });
    } catch (error) {
      info = null;
      renderDialogError(backdrop, error.message);
      return;
    }
    if (!backdrop.isConnected) return;
    if (!info) {
      renderDialogError(backdrop, "Requests aren't available for this show right now.");
      return;
    }
    renderSeasonDialog(backdrop, itemId, info);
  }

  function renderDialogError(backdrop, message) {
    const dialog = backdrop.querySelector(".jsb-dialog");
    if (!dialog) return;
    dialog.innerHTML = `<h2 id="jsb-dialog-title">Request seasons</h2><div class="jsb-dialog-message is-error">${escapeHtml(message)}</div><div class="jsb-dialog-actions"><span class="jsb-spacer"></span><button type="button" data-jsb="cancel">Close</button></div>`;
    dialog.querySelector("[data-jsb='cancel']").addEventListener("click", closeSeasonDialog);
  }

  function renderSeasonDialog(backdrop, itemId, info) {
    const dialog = backdrop.querySelector(".jsb-dialog");
    const rows = info.seasons.map((season) => {
      const pickable = season.state === "missing" || season.state === "upcoming";
      // Missing seasons start ticked so requesting all of them is one click.
      const checked = season.state === "missing";
      return [
        `<label class="jsb-season-row${pickable ? "" : " is-disabled"}">`,
        `<input type="checkbox" value="${season.number}"${checked ? " checked" : ""}${pickable ? "" : " disabled"}>`,
        `<span class="jsb-season-name">${escapeHtml(season.name)}</span>`,
        `<span class="jsb-season-state">${escapeHtml(season.label)}</span>`,
        `</label>`
      ].join("");
    }).join("");

    dialog.innerHTML = [
      `<h2 id="jsb-dialog-title">Request seasons of ${escapeHtml(info.showName)}</h2>`,
      `<p class="jsb-dialog-hint">Missing seasons are ticked already. Untick any you don't want, or tick upcoming ones to get them when they air.</p>`,
      `<div class="jsb-season-list">${rows}</div>`,
      `<div class="jsb-dialog-message" role="status" aria-live="polite"></div>`,
      `<div class="jsb-dialog-actions">`,
      `<button type="button" data-jsb="all">Select all missing</button>`,
      `<button type="button" data-jsb="none">Clear</button>`,
      `<span class="jsb-spacer"></span>`,
      `<button type="button" data-jsb="cancel">Cancel</button>`,
      `<button type="button" class="jsb-primary" data-jsb="submit"></button>`,
      `</div>`
    ].join("");

    const boxes = Array.from(dialog.querySelectorAll("input[type='checkbox']:not(:disabled)"));
    const submitButton = dialog.querySelector("[data-jsb='submit']");
    const message = dialog.querySelector(".jsb-dialog-message");

    const selected = () => boxes.filter((box) => box.checked).map((box) => Number(box.value));
    const updateSubmit = () => {
      const count = selected().length;
      submitButton.textContent = count ? `Request ${count} season${count === 1 ? "" : "s"}` : "Request";
      submitButton.disabled = count === 0;
    };

    boxes.forEach((box) => box.addEventListener("change", updateSubmit));
    dialog.querySelector("[data-jsb='all']").addEventListener("click", () => {
      boxes.forEach((box) => {
        box.checked = info.seasons.find((season) => season.number === Number(box.value))?.state === "missing";
      });
      updateSubmit();
    });
    dialog.querySelector("[data-jsb='none']").addEventListener("click", () => {
      boxes.forEach((box) => { box.checked = false; });
      updateSubmit();
    });
    dialog.querySelector("[data-jsb='cancel']").addEventListener("click", closeSeasonDialog);

    submitButton.addEventListener("click", async () => {
      const seasons = selected();
      if (!seasons.length) return;

      submitButton.disabled = true;
      submitButton.textContent = "Requesting...";
      message.className = "jsb-dialog-message";
      message.textContent = "";
      try {
        await callServer("/JellyseerrBridge/Request", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mediaType: "tv", mediaId: info.tmdbId, is4k: false, seasons })
        });

        const names = seasons.map((number) => `Season ${number}`);
        const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0];
        message.className = "jsb-dialog-message is-success";
        message.innerHTML = `Requested ${escapeHtml(list)}. You can follow the progress on the <a href="${escapeHtml(REQUEST_URL)}">Requests page</a>.`;
        boxes.forEach((box) => { box.disabled = true; });
        submitButton.textContent = "Done";
        dialog.querySelector("[data-jsb='cancel']").textContent = "Close";

        // Make the show page button reflect the new state next time it's drawn.
        seriesCache.delete(itemId);
        document.querySelectorAll(".jellyseerr-bridge-seasons-button").forEach((button) => button.remove());
      } catch (error) {
        message.className = "jsb-dialog-message is-error";
        message.textContent = `The request didn't go through: ${error.message}`;
        updateSubmit();
      }
    });

    updateSubmit();
    (boxes.find((box) => box.checked) || boxes[0] || submitButton).focus();
  }

  function insertEntries() {
    insertTopTab();
    insertSideMenuItem();
    insertUserMenuItem();
    insertSeasonsButton();
  }

  insertEntries();
  setInterval(insertEntries, 1000);
  // Jellyfin Web moves between pages by changing the hash, so react to that straight away.
  window.addEventListener("hashchange", insertEntries);
  new MutationObserver(insertEntries).observe(document.documentElement, { childList: true, subtree: true });
})();
