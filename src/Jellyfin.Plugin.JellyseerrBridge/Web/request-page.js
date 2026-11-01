(() => {
  "use strict";

  const API = "/JellyseerrBridge";

  // How often titles that are waiting or downloading get re-checked while the page is open.
  // Jellyseerr itself only syncs with Radarr and Sonarr about once a minute.
  const REFRESH_MS = 30000;

  // An approved request with nothing downloading after this long probably means Radarr or
  // Sonarr couldn't find a copy, so the detail page says so instead of "waiting".
  const STALLED_AFTER_MS = 30 * 60 * 1000;
  const MAX_REFRESH_PER_ROUND = 8;
  const CATEGORIES = [
    { id: "trending", label: "Trending" },
    { id: "movies", label: "Movies" },
    { id: "upcoming-movies", label: "Upcoming Movies" },
    { id: "shows", label: "Shows" },
    { id: "upcoming-shows", label: "Upcoming Shows" },
    { id: "mine", label: "My Requests" }
  ];

  const state = {
    category: "trending",
    query: "",
    page: 1,
    pageInfo: null,
    loading: false,
    detailLoading: false,
    detail: null,
    detailBase: null,
    // Ratings, similar titles and the film collection for the open detail page. These load
    // after the main details so the page doesn't wait on them.
    extras: null,
    // The signed-in user's request limits from Jellyseerr, if any are set.
    quota: null,
    // The "Report a problem" form on the open detail page, including anything typed so far,
    // so it survives the page redrawing while someone is filling it in.
    report: null,
    results: [],
    local: new Map(),
    pending: new Set(),
    searchTimer: 0,
    status: null,
    sort: "",
    filters: {
      rating: "",
      releaseFrom: "",
      releaseTo: "",
      provider: ""
    }
  };

  const els = {
    status: document.getElementById("status"),
    quota: document.getElementById("quota"),
    search: document.getElementById("search"),
    filterToggle: document.getElementById("filterToggle"),
    sortToggle: document.getElementById("sortToggle"),
    filters: document.getElementById("filters"),
    sorts: document.getElementById("sorts"),
    sortSelect: document.getElementById("sortSelect"),
    ratingFilter: document.getElementById("ratingFilter"),
    releaseFromFilter: document.getElementById("releaseFromFilter"),
    releaseToFilter: document.getElementById("releaseToFilter"),
    providerFilter: document.getElementById("providerFilter"),
    applyFilters: document.getElementById("applyFilters"),
    clearFilters: document.getElementById("clearFilters"),
    applySort: document.getElementById("applySort"),
    clearSort: document.getElementById("clearSort"),
    detailBack: document.getElementById("detailBack"),
    tabs: document.getElementById("tabs"),
    results: document.getElementById("results"),
    footer: document.getElementById("footer")
  };

  // Jellyfin Web can remember several servers. Only send this server's own sign-in token, so a
  // token for another server never goes to this one. If there's just one saved server, it's
  // this one even when it was saved under a different address (LAN IP versus domain, say).
  function serverForThisPage(servers) {
    const signedIn = servers.filter((server) => server.AccessToken);
    const isThisServer = (address) => {
      try {
        return Boolean(address) && new URL(address).origin === window.location.origin;
      } catch {
        return false;
      }
    };
    return signedIn.find((server) => [server.ManualAddress, server.LocalAddress, server.RemoteAddress].some(isThisServer))
      || (signedIn.length === 1 ? signedIn[0] : null);
  }

  function authHeader() {
    try {
      const raw = localStorage.getItem("jellyfin_credentials");
      const credentials = raw ? JSON.parse(raw) : null;
      const server = serverForThisPage(credentials?.Servers || []);
      const token = server?.AccessToken;
      if (!token) return {};
      return {
        Authorization: `MediaBrowser Client="Jellyseerr Bridge", Device="Browser", DeviceId="jellyseerr-bridge-web", Version="0.2.0", Token="${token}"`
      };
    } catch {
      return {};
    }
  }

  async function apiGet(path) {
    const response = await fetch(`${API}${path}`, {
      cache: "no-store",
      headers: authHeader()
    });
    if (!response.ok) throw new Error(await errorMessage(response));
    return response.json();
  }

  async function apiPost(path, payload) {
    const response = await fetch(`${API}${path}`, {
      method: "POST",
      cache: "no-store",
      headers: {
        ...authHeader(),
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    if (!response.ok && response.status !== 202) throw new Error(await errorMessage(response));
    return response.text().then((text) => text ? JSON.parse(text) : null);
  }

  async function errorMessage(response) {
    const text = await response.text();
    try {
      return JSON.parse(text).message || `${response.status} ${response.statusText}`;
    } catch {
      return text || `${response.status} ${response.statusText}`;
    }
  }

  async function loadStatus() {
    try {
      state.status = await apiGet("/Status");
      if (!state.status?.isConfigured) {
        els.status.textContent = "Jellyseerr Bridge is not configured yet.";
      } else if (!state.status?.requestSubmissionEnabled) {
        els.status.textContent = "Search is available. Request submission is disabled by the Jellyfin administrator.";
      }
    } catch {
      state.status = { isConfigured: true, requestSubmissionEnabled: true };
      els.status.textContent = "Request status could not be checked. You can still try submitting a request.";
    }
  }

  async function loadQuota() {
    try {
      state.quota = await apiGet("/Quota");
    } catch {
      state.quota = null;
    }
    renderQuota();
  }

  // Jellyseerr's quota has a movie and a tv section, each with a limit over a number of days.
  // A limit of 0 or nothing means unlimited, which isn't worth mentioning.
  function quotaText(kind, quota) {
    const limit = Number(quota?.limit) || 0;
    if (!limit) return "";

    const used = Number(quota.used) || 0;
    const remaining = Math.max(0, Number.isFinite(Number(quota.remaining)) ? Number(quota.remaining) : limit - used);
    // Jellyseerr's limits are rolling, counted over the last so many days.
    const days = Number(quota.days) || 0;
    const period = days === 7 ? " this week" : days === 1 ? " today" : days ? ` (limit is per ${days} days)` : "";
    const text = `${remaining} of ${limit} ${kind.toLowerCase()} requests left${period}`;
    return remaining === 0 ? `${text}. You've reached the limit for now.` : text;
  }

  function renderQuota() {
    if (!els.quota) return;
    const parts = [quotaText("Movie", state.quota?.movie), quotaText("Show", state.quota?.tv)].filter(Boolean);
    els.quota.textContent = parts.join("  |  ");
    els.quota.hidden = parts.length === 0;
  }

  async function loadResults({ append = false } = {}) {
    state.loading = true;
    state.detail = null;
    state.detailBase = null;
    renderBody();
    try {
      const page = append ? state.page + 1 : 1;
      const data = await fetchResultPage(page);
      const incoming = filterResults(normalize(data.results || []));
      state.results = sortResults(append ? mergeUniqueResults(state.results, incoming) : dedupeResults(incoming));
      state.page = page;
      state.pageInfo = data;
    } catch (error) {
      state.results = append ? state.results : [];
      els.results.innerHTML = `<div class="message">${escapeHtml(error.message)}</div>`;
    } finally {
      state.loading = false;
      renderBody();
    }
  }

  async function fetchResultPage(page) {
    if (state.category === "mine" && !state.query) {
      return apiGet(`/MyRequests?page=${page}`);
    }

    if (state.query) {
      return apiGet(`/Search?query=${encodeURIComponent(state.query)}&page=${page}`);
    }

    if (state.category === "trending" && (hasActiveFilters() || hasActiveSort())) {
      const [movies, shows] = await Promise.all([
        apiGet(`/Discover/movies?page=${page}${discoverFilterQuery("movie")}`),
        apiGet(`/Discover/shows?page=${page}${discoverFilterQuery("tv")}`)
      ]);
      return {
        page,
        totalPages: Math.max(movies.totalPages || 1, shows.totalPages || 1),
        totalResults: (movies.totalResults || 0) + (shows.totalResults || 0),
        results: mergeInterleaved(movies.results || [], shows.results || [])
      };
    }

    return apiGet(`/Discover/${encodeURIComponent(state.category)}?page=${page}${discoverFilterQuery(mediaKindForCategory(state.category))}`);
  }

  async function loadDetail(item) {
    state.detailBase = item;
    state.detail = null;
    state.extras = null;
    state.report = null;
    state.detailLoading = true;
    renderBody();
    try {
      const endpoint = item.mediaType === "tv" ? `/Tv/${item.id}` : `/Movie/${item.id}`;
      state.detail = normalizeDetail(await apiGet(endpoint), item);
      loadExtras(state.detail);
    } catch (error) {
      state.detail = { ...item, error: error.message };
    } finally {
      state.detailLoading = false;
      renderBody();
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  // Each of these is optional. If one fails (an older Jellyseerr without the ratings
  // endpoint, say), that section is just left out.
  async function loadExtras(item) {
    const base = item.mediaType === "tv" ? `/Tv/${item.id}` : `/Movie/${item.id}`;
    const [ratings, recommendations, collection] = await Promise.allSettled([
      apiGet(`${base}/Ratings`),
      apiGet(`${base}/Recommendations`),
      item.collection ? apiGet(`/Collection/${item.collection.id}`) : Promise.resolve(null)
    ]);

    // The user may have opened a different title while these were loading.
    if (!state.detail || key(state.detail) !== key(item)) return;

    state.extras = {
      ratings: ratings.status === "fulfilled" ? normalizeRatings(ratings.value) : [],
      recommendations: recommendations.status === "fulfilled"
        ? normalize(recommendations.value?.results || []).filter((entry) => key(entry) !== key(item)).slice(0, 12)
        : [],
      collection: collection.status === "fulfilled" && collection.value
        ? normalizeCollection(collection.value, item.collection)
        : null
    };
    renderBody();
  }

  function normalizeCollection(collection, fallback) {
    const parts = normalize((collection.parts || []).map((part) => ({ ...part, mediaType: part.mediaType || "movie" })))
      .sort((left, right) => compareDate(left.releaseDate, right.releaseDate));
    return parts.length > 1 ? { id: collection.id || fallback.id, name: collection.name || fallback.name, parts } : null;
  }

  // Jellyseerr's movie ratings have Rotten Tomatoes under "rt" and IMDb under "imdb". The
  // older and TV endpoints return the Rotten Tomatoes object on its own.
  function normalizeRatings(value) {
    if (!value || typeof value !== "object") return [];
    const rottenTomatoes = value.rt || (value.criticsScore !== undefined ? value : null);
    const imdb = value.imdb || null;
    const ratings = [];

    if (imdb && Number(imdb.criticsScore) > 0) {
      ratings.push({ label: "IMDb", value: Number(imdb.criticsScore).toFixed(1), url: imdb.url });
    }
    if (rottenTomatoes && Number.isFinite(Number(rottenTomatoes.criticsScore)) && rottenTomatoes.criticsScore !== null) {
      ratings.push({ label: "Rotten Tomatoes", value: `${rottenTomatoes.criticsScore}%`, url: rottenTomatoes.url });
    }
    if (rottenTomatoes && Number.isFinite(Number(rottenTomatoes.audienceScore)) && rottenTomatoes.audienceScore !== null) {
      ratings.push({ label: "Audience", value: `${rottenTomatoes.audienceScore}%`, url: rottenTomatoes.url });
    }
    return ratings;
  }

  function normalize(items) {
    return items
      .filter((item) => item && (item.mediaType === "movie" || item.mediaType === "tv"))
      .map(normalizeItem);
  }

  function normalizeItem(item) {
    return {
      id: item.id,
      mediaType: item.mediaType,
      title: item.title || item.name || item.originalTitle || item.originalName || "Untitled",
      releaseDate: item.releaseDate || item.firstAirDate || item.airDate || "",
      year: (item.releaseDate || item.firstAirDate || item.airDate || "").slice(0, 4),
      rating: item.voteAverage || item.vote_average || 0,
      posterPath: item.posterPath,
      backdropPath: item.backdropPath,
      overview: item.overview || "",
      tagline: item.tagline || "",
      runtime: item.runtime,
      genres: (item.genres || []).map((genre) => genre.name || genre).filter(Boolean),
      mediaInfo: item.mediaInfo || null,
      // Only set on the My Requests tab: the request itself, as opposed to the title.
      bridgeRequest: item.bridgeRequest || null
    };
  }

  function normalizeDetail(detail, base) {
    const item = normalizeItem({
      ...detail,
      id: detail.id || base.id,
      mediaType: base.mediaType,
      title: detail.title || detail.name || base.title,
      posterPath: detail.posterPath || base.posterPath,
      mediaInfo: detail.mediaInfo || base.mediaInfo
    });
    item.seasons = base.mediaType === "tv" ? normalizeSeasons(detail, item) : [];
    item.cast = (detail.credits?.cast || []).slice(0, 15).map((person) => ({
      name: person.name || "",
      character: person.character || "",
      profilePath: person.profilePath || ""
    })).filter((person) => person.name);
    item.collection = detail.collection?.id ? { id: detail.collection.id, name: detail.collection.name || "Collection" } : null;
    return item;
  }

  function normalizeSeasons(detail, show) {
    const mediaSeasons = [
      ...(detail.mediaInfo?.seasons || []),
      ...(detail.mediaInfo?.seasonRequests || [])
    ];
    return (detail.seasons || [])
      .filter((season) => Number(season.seasonNumber) > 0)
      .map((season) => {
        const seasonNumber = Number(season.seasonNumber);
        const mediaSeason = mediaSeasons.find((item) => Number(item.seasonNumber) === seasonNumber) || {};
        return {
          showId: show.id,
          mediaType: "tv",
          seasonNumber,
          title: season.name || `Season ${seasonNumber}`,
          overview: season.overview || "",
          posterPath: season.posterPath || show.posterPath,
          airDate: season.airDate || season.air_date || "",
          episodeCount: season.episodeCount || season.episode_count,
          status: mediaSeason.status ?? season.status ?? null
        };
      });
  }

  function mergeUniqueResults(existing, incoming) {
    return dedupeResults(existing.concat(incoming));
  }

  function dedupeResults(items) {
    const byKey = new Map();
    for (const item of items) {
      const itemKey = key(item);
      const current = byKey.get(itemKey);
      byKey.set(itemKey, chooseBetterResult(current, item));
    }
    return Array.from(byKey.values());
  }

  function chooseBetterResult(current, candidate) {
    if (!current) return candidate;
    const currentScore = resultCompleteness(current);
    const candidateScore = resultCompleteness(candidate);
    if (candidateScore > currentScore) {
      return { ...current, ...candidate };
    }
    return { ...candidate, ...current };
  }

  function resultCompleteness(item) {
    return [
      item.title,
      item.year,
      item.rating,
      item.posterPath,
      item.overview,
      item.mediaInfo,
      item.mediaInfo?.status
    ].filter((value) => value !== null && value !== undefined && value !== "").length;
  }

  function key(item) {
    return `${item.mediaType}:${item.id}`;
  }

  function seasonKey(show, seasonNumber) {
    return `tv:${show.id}:season:${seasonNumber}`;
  }

  function requestKey(item, seasonNumber) {
    return seasonNumber === undefined ? key(item) : seasonKey(item, seasonNumber);
  }

  function providerRegion() {
    const region = (navigator.language || "").split("-")[1];
    return /^[A-Z]{2}$/.test(region || "") ? region : "US";
  }

  function hasActiveFilters() {
    return Boolean(state.filters.rating || state.filters.releaseFrom || state.filters.releaseTo || state.filters.provider);
  }

  function hasActiveSort() {
    return Boolean(state.sort);
  }

  function mediaKindForCategory(category) {
    return category === "shows" || category === "upcoming-shows" ? "tv" : "movie";
  }

  function discoverFilterQuery(mediaKind) {
    if (state.category === "trending" && !hasActiveFilters() && !hasActiveSort()) return "";

    const params = new URLSearchParams();
    const sortBy = sortByForMediaKind(mediaKind);
    if (sortBy) params.set("sortBy", sortBy);
    if (state.filters.rating) params.set("voteAverageGte", state.filters.rating);
    if (state.filters.provider) {
      params.set("watchProviders", state.filters.provider);
      params.set("watchRegion", providerRegion());
    }

    if (state.filters.releaseFrom) {
      params.set(mediaKind === "tv" ? "firstAirDateGte" : "primaryReleaseDateGte", state.filters.releaseFrom);
    }

    if (state.filters.releaseTo) {
      params.set(mediaKind === "tv" ? "firstAirDateLte" : "primaryReleaseDateLte", state.filters.releaseTo);
    }

    const value = params.toString();
    return value ? `&${value}` : "";
  }

  function sortByForMediaKind(mediaKind) {
    switch (state.sort) {
      case "release-desc":
        return mediaKind === "tv" ? "first_air_date.desc" : "primary_release_date.desc";
      case "release-asc":
        return mediaKind === "tv" ? "first_air_date.asc" : "primary_release_date.asc";
      case "rating-desc":
        return "vote_average.desc";
      case "rating-asc":
        return "vote_average.asc";
      case "title-asc":
        return mediaKind === "tv" ? "name.asc" : "original_title.asc";
      case "title-desc":
        return mediaKind === "tv" ? "name.desc" : "original_title.desc";
      default:
        return "";
    }
  }

  function mergeInterleaved(left, right) {
    const merged = [];
    const count = Math.max(left.length, right.length);
    for (let index = 0; index < count; index += 1) {
      if (left[index]) merged.push(left[index]);
      if (right[index]) merged.push(right[index]);
    }
    return merged;
  }

  function filterResults(items) {
    if (!state.query) return items;
    return items.filter((item) => {
      if (state.filters.rating && Number(item.rating || 0) < Number(state.filters.rating)) return false;
      if (state.filters.releaseFrom && item.releaseDate && item.releaseDate < state.filters.releaseFrom) return false;
      if (state.filters.releaseTo && item.releaseDate && item.releaseDate > state.filters.releaseTo) return false;
      return true;
    });
  }

  function sortResults(items) {
    if (!state.sort) return items;

    const sorted = [...items];
    sorted.sort((left, right) => {
      switch (state.sort) {
        case "release-desc":
          return compareDate(right.releaseDate, left.releaseDate) || compareTitle(left, right);
        case "release-asc":
          return compareDate(left.releaseDate, right.releaseDate) || compareTitle(left, right);
        case "rating-desc":
          return compareNumber(right.rating, left.rating) || compareTitle(left, right);
        case "rating-asc":
          return compareNumber(left.rating, right.rating) || compareTitle(left, right);
        case "title-desc":
          return compareTitle(right, left);
        case "title-asc":
          return compareTitle(left, right);
        default:
          return 0;
      }
    });
    return sorted;
  }

  function compareDate(left, right) {
    const leftTime = left ? Date.parse(left) : Number.NaN;
    const rightTime = right ? Date.parse(right) : Number.NaN;
    const leftMissing = Number.isNaN(leftTime);
    const rightMissing = Number.isNaN(rightTime);
    if (leftMissing && rightMissing) return 0;
    if (leftMissing) return 1;
    if (rightMissing) return -1;
    return leftTime - rightTime;
  }

  function compareNumber(left, right) {
    const leftNumber = Number(left);
    const rightNumber = Number(right);
    const leftMissing = Number.isNaN(leftNumber);
    const rightMissing = Number.isNaN(rightNumber);
    if (leftMissing && rightMissing) return 0;
    if (leftMissing) return 1;
    if (rightMissing) return -1;
    return leftNumber - rightNumber;
  }

  function compareTitle(left, right) {
    return String(left.title || "").localeCompare(String(right.title || ""), undefined, { sensitivity: "base", numeric: true });
  }

  // Jellyseerr's media status numbers. 2 means the request is waiting for an admin, 3 means
  // it was approved and handed to Radarr or Sonarr.
  function statusName(status) {
    if (status === 5) return "available";
    if (status === 4) return "partially available";
    if (status === 3) return "approved";
    if (status === 2) return "pending approval";
    if (status === 6) return "blocklisted";
    if (status === 7) return "deleted";
    return "not available";
  }

  function statusFor(item) {
    const local = state.local.get(key(item));
    if (local) return local;
    if (downloadsFor(item).length) return "downloading";
    return statusName(item.mediaInfo?.status);
  }

  function statusForSeason(show, season) {
    const local = state.local.get(seasonKey(show, season.seasonNumber));
    if (local) return local;
    if (downloadsFor(show, season.seasonNumber).length) return "downloading";
    return statusName(season.status);
  }

  // Jellyseerr copies Radarr's and Sonarr's download queues onto each title as
  // mediaInfo.downloadStatus. For shows there's one entry per episode being downloaded.
  function downloadsFor(item, seasonNumber) {
    const downloads = item?.mediaInfo?.downloadStatus || [];
    if (seasonNumber === undefined) return downloads;
    return downloads.filter((download) => Number(download.episode?.seasonNumber) === seasonNumber);
  }

  function summarizeDownloads(downloads) {
    if (!downloads.length) return null;

    let size = 0;
    let sizeLeft = 0;
    let finishesAt = 0;
    for (const download of downloads) {
      size += Number(download.size) || 0;
      sizeLeft += Number(download.sizeLeft) || 0;
      finishesAt = Math.max(finishesAt, finishTime(download));
    }

    const states = downloads.map((download) => String(download.status || "").toLowerCase());
    return {
      count: downloads.length,
      percent: size > 0 ? Math.min(100, Math.max(0, Math.round(((size - sizeLeft) / size) * 100))) : null,
      state: states.includes("downloading") ? "downloading" : (states[0] || "queued"),
      finishesAt
    };
  }

  // Prefers the estimated completion time. Falls back to Radarr's "timeLeft", which looks
  // like "00:12:34", or "1.02:03:04" when it's more than a day.
  function finishTime(download) {
    const eta = Date.parse(download.estimatedCompletionTime || "");
    if (!Number.isNaN(eta)) return eta;

    const match = String(download.timeLeft || "").match(/^(?:(\d+)\.)?(\d+):(\d+):(\d+)/);
    if (!match) return 0;
    const [, days, hours, minutes, seconds] = match.map((part) => Number(part) || 0);
    return Date.now() + ((((days * 24) + hours) * 60 + minutes) * 60 + seconds) * 1000;
  }

  function describeDownloadState(downloadState) {
    switch (downloadState) {
      case "queued":
      case "delay":
        return "Queued";
      case "paused":
        return "Paused";
      case "completed":
      case "importing":
      case "importpending":
        return "Finishing up";
      case "warning":
        return "Download has a problem";
      case "failed":
        return "Download failed";
      default:
        return "Downloading";
    }
  }

  function timeLeftText(finishesAt) {
    const milliseconds = finishesAt - Date.now();
    if (!finishesAt || milliseconds <= 0) return "";

    const minutes = Math.round(milliseconds / 60000);
    if (minutes < 1) return "less than a minute left";
    if (minutes < 60) return `about ${minutes} min left`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `about ${hours} h ${minutes % 60} min left`;

    const days = Math.round(hours / 24);
    return `about ${days} day${days === 1 ? "" : "s"} left`;
  }

  function downloadText(summary, mediaType) {
    let text = describeDownloadState(summary.state);
    if (summary.percent !== null) text += ` ${summary.percent}%`;

    const parts = [text];
    if (summary.count > 1) parts.push(`${summary.count} ${mediaType === "tv" ? "episodes" : "downloads"}`);
    if (summary.state === "downloading") {
      const remaining = timeLeftText(summary.finishesAt);
      if (remaining) parts.push(remaining);
    }
    return parts.join(", ");
  }

  function renderProgress(downloads, mediaType, extraClass = "") {
    const summary = summarizeDownloads(downloads);
    if (!summary) return "";

    const text = downloadText(summary, mediaType);
    const percent = summary.percent ?? 0;
    const idle = summary.state === "downloading" ? "" : " idle";
    return [
      `<div class="download-progress${extraClass ? ` ${escapeHtml(extraClass)}` : ""}">`,
      `<div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}" aria-label="${escapeHtml(text)}">`,
      `<div class="progress-fill${idle}" style="width: ${percent}%"></div>`,
      `</div>`,
      `<div class="progress-text">${escapeHtml(text)}</div>`,
      `</div>`
    ].join("");
  }

  // A short explanation under the request button on the detail page, so nobody is left
  // guessing what "approved" means when nothing is downloading yet.
  function statusNote(status, item) {
    if (status === "pending approval") return "Waiting for an admin to approve the request in Jellyseerr.";
    if (status === "requested") return "Request sent. Checking its status...";
    if (status !== "approved") return "";

    const since = approvedSince(item);
    if (since && Date.now() - since > STALLED_AFTER_MS) {
      const manager = item.mediaType === "tv" ? "Sonarr" : "Radarr";
      return `Approved ${durationText(Date.now() - since)} ago, but nothing is downloading. ${manager} may not have found a copy yet, or the download finished and Jellyfin hasn't picked it up.`;
    }
    return "Approved. Waiting for a download to start, or for Jellyfin to add the finished download.";
  }

  // When the newest approved request was approved. Jellyseerr updates a request's
  // "updatedAt" when an admin approves it, so that's used before "createdAt".
  function approvedSince(item) {
    const approved = (item?.mediaInfo?.requests || []).filter((request) => !request.is4k && request.status === 2);
    const times = approved
      .map((request) => Date.parse(request.updatedAt || request.createdAt || ""))
      .filter((time) => !Number.isNaN(time));
    return times.length ? Math.max(...times) : 0;
  }

  function durationText(milliseconds) {
    const minutes = Math.floor(milliseconds / 60000);
    if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;

    const hours = Math.floor(minutes / 60);
    if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"}`;

    const days = Math.floor(hours / 24);
    return `${days} days`;
  }

  // Jellyseerr stores the Jellyfin item ID once a title is in the library. The request page
  // lives at /JellyseerrBridge/Page, so "../web/" reaches Jellyfin Web even with a base URL.
  function jellyfinUrl(item) {
    const id = item?.mediaInfo?.jellyfinMediaId;
    if (!id || !/^[0-9a-f-]{32,36}$/i.test(id)) return "";
    const status = item.mediaInfo.status;
    return status === 4 || status === 5 ? `../web/#/details?id=${encodeURIComponent(id)}` : "";
  }

  function renderOpenLink(item, extraClass = "") {
    const url = jellyfinUrl(item);
    return url ? `<a class="action open${extraClass ? ` ${escapeHtml(extraClass)}` : ""}" href="${escapeHtml(url)}">Open in Jellyfin</a>` : "";
  }

  // Jellyseerr's request status numbers. 3 is declined and 4 means it couldn't be sent to
  // Radarr or Sonarr. Every request currently goes in under the Jellyseerr admin, so this
  // says "a request" rather than naming who asked.
  function requestHistory(item) {
    const requests = (item?.mediaInfo?.requests || []).filter((request) => !request.is4k);
    if (!requests.length) return "";

    const latest = requests.reduce((newest, request) => (
      Date.parse(request.createdAt || "") > Date.parse(newest.createdAt || "") ? request : newest
    ));
    const date = formatDate(latest.createdAt);
    const when = date ? ` on ${date}` : "";

    if (latest.status === 3) return `A request${when} was declined. You can request it again.`;
    if (latest.status === 4) return `A request${when} couldn't be sent to the download manager. An admin needs to retry it in Jellyseerr.`;
    return date ? `Requested on ${date}.` : "";
  }

  function formatDate(value) {
    const time = Date.parse(value || "");
    return Number.isNaN(time) ? "" : new Date(time).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  function safeExternalUrl(value) {
    return /^https:\/\//i.test(value || "") ? value : "";
  }

  function actionForStatus(label, status, pending) {
    if (pending) return { label: "Requesting", disabled: true, muted: true };
    if (status === "available") return { label: "Available", disabled: true, muted: true };
    if (status === "downloading") return { label: "Downloading", disabled: true, muted: true };
    if (status === "requested" || status === "pending approval" || status === "approved") return { label: "Requested", disabled: true, muted: true };
    if (status === "blocklisted") return { label: "Blocked", disabled: true, muted: true };
    if (status.startsWith("error:")) return { label: "Retry", disabled: false, muted: false, error: true };
    const requestsDisabled = state.status?.requestSubmissionEnabled === false;
    return { label, disabled: requestsDisabled, muted: requestsDisabled };
  }

  function actionFor(item) {
    return actionForStatus(
      item.mediaType === "tv" ? "Request Show" : "Request",
      statusFor(item),
      state.pending.has(key(item))
    );
  }

  function actionForSeason(show, season) {
    return actionForStatus(
      "Request Season",
      statusForSeason(show, season),
      state.pending.has(seasonKey(show, season.seasonNumber))
    );
  }

  function requestBody(item, seasonNumber) {
    const body = {
      mediaType: item.mediaType === "tv" ? "tv" : "movie",
      mediaId: item.id,
      is4k: false
    };
    if (item.mediaType === "tv") body.seasons = seasonNumber === undefined ? "all" : [seasonNumber];
    return body;
  }

  async function submit(item, seasonNumber) {
    const itemKey = requestKey(item, seasonNumber);
    if (state.pending.has(itemKey)) return;
    state.pending.add(itemKey);
    renderBody();
    try {
      await apiPost("/Request", requestBody(item, seasonNumber));
      state.local.set(itemKey, "requested");
      // Jellyseerr may auto-approve, so look up what actually happened rather than assume.
      refreshTitles([item]);
      loadQuota();
    } catch (error) {
      state.local.set(itemKey, error.message.toLowerCase().includes("already") ? "requested" : `error: ${error.message}`);
    } finally {
      state.pending.delete(itemKey);
      renderBody();
    }
  }

  function renderTabs() {
    els.tabs.innerHTML = CATEGORIES.map((category) => (
      `<button class="tab${category.id === state.category && !state.query ? " selected" : ""}" data-category="${escapeHtml(category.id)}">${escapeHtml(category.label)}</button>`
    )).join("");
  }

  function readFilters() {
    state.filters = {
      rating: els.ratingFilter.value,
      releaseFrom: els.releaseFromFilter.value,
      releaseTo: els.releaseToFilter.value,
      provider: els.providerFilter.value
    };
  }

  function readSort() {
    state.sort = els.sortSelect.value;
  }

  function resetAndLoad() {
    state.results = [];
    state.detail = null;
    state.detailBase = null;
    state.page = 1;
    renderTabs();
    loadResults();
  }

  function renderBody() {
    if (state.detailBase) {
      renderDetail();
      return;
    }

    if (els.detailBack) els.detailBack.hidden = true;
    if (state.loading && state.results.length === 0) {
      els.results.innerHTML = `<div class="message">Loading...</div>`;
    } else if (state.results.length === 0) {
      const empty = state.category === "mine" && !state.query ? "You haven't requested anything yet." : "No results found.";
      els.results.innerHTML = `<div class="message">${escapeHtml(empty)}</div>`;
    } else {
      els.results.innerHTML = `<div class="grid">${state.results.map(renderCard).join("")}</div>`;
    }
    els.footer.innerHTML = canLoadMore() ? `<button class="more" data-load-more="true">Load more</button>` : "";
  }

  function renderDetail() {
    if (els.detailBack) els.detailBack.hidden = false;
    els.footer.innerHTML = "";
    if (state.detailLoading) {
      els.results.innerHTML = `<div class="detail"><div class="message">Loading details...</div></div>`;
      return;
    }

    const item = state.detail || state.detailBase;
    if (item.error) {
      els.results.innerHTML = `<div class="detail"><div class="message">${escapeHtml(item.error)}</div></div>`;
      return;
    }

    const meta = [
      item.mediaType === "tv" ? "Series" : "Movie",
      item.year,
      item.runtime ? `${item.runtime} min` : "",
      ...(item.genres || []).slice(0, 3)
    ].filter(Boolean).join(" - ");

    els.results.innerHTML = [
      `<article class="detail">`,
      `<section class="detail-hero">`,
      poster(item, "detail-poster"),
      `<div class="detail-copy">`,
      `<div class="status">${escapeHtml(meta)}</div>`,
      `<h2>${escapeHtml(item.title)}${item.year ? ` (${escapeHtml(item.year)})` : ""}</h2>`,
      item.tagline ? `<div class="tagline">${escapeHtml(item.tagline)}</div>` : "",
      renderRatings(item),
      item.overview ? `<p class="overview">${escapeHtml(item.overview)}</p>` : `<p class="overview">No overview available.</p>`,
      item.mediaType === "movie" ? renderMovieAction(item) : renderSeriesSummary(item),
      renderReport(item),
      `</div>`,
      `</section>`,
      item.mediaType === "tv" ? renderSeasonGrid(item) : "",
      renderCast(item),
      renderCollection(),
      renderRecommendations(),
      `</article>`
    ].join("");
  }

  function renderMovieAction(item) {
    const action = actionFor(item);
    const payload = escapeHtml(JSON.stringify({ id: item.id, mediaType: item.mediaType }));
    const openLink = renderOpenLink(item, "detail-action");
    return [
      // Once it's in the library, opening it is more useful than a greyed-out "Available".
      openLink || `<button class="action detail-action${action.muted ? " muted" : ""}${action.error ? " error" : ""}" data-request="${payload}" ${action.disabled ? "disabled" : ""}>${escapeHtml(action.label)}</button>`,
      renderProgress(downloadsFor(item), item.mediaType, "detail-progress"),
      renderNotes(item, statusFor(item))
    ].join("");
  }

  function renderSeriesSummary(item) {
    const seasonCount = item.seasons?.length || 0;
    const status = statusFor(item);
    return [
      `<div class="series-summary">${escapeHtml(seasonCount)} seasons - ${escapeHtml(status)}</div>`,
      renderOpenLink(item, "detail-action"),
      renderProgress(downloadsFor(item), item.mediaType, "detail-progress"),
      renderNotes(item, status)
    ].join("");
  }

  function renderNotes(item, status) {
    const notes = [statusNote(status, item), requestHistory(item)].filter(Boolean);
    return notes.map((note) => `<div class="status-note">${escapeHtml(note)}</div>`).join("");
  }

  // Only titles in the library can have problems. Jellyseerr files issues against its own
  // media ID (mediaInfo.id), not the TMDB one.
  function canReport(item) {
    const status = item?.mediaInfo?.status;
    return Number(item?.mediaInfo?.id) > 0 && (status === 4 || status === 5);
  }

  function renderReport(item) {
    if (!canReport(item)) return "";

    const report = state.report && state.report.key === key(item) ? state.report : null;
    if (!report || !report.open) {
      return [
        report?.done ? `<div class="status-note report-done">Thanks. Your report is in Jellyseerr for an admin to look at.</div>` : "",
        `<button class="action secondary detail-action" type="button" data-report-open="true">Report a problem</button>`
      ].join("");
    }

    const draft = report.draft;
    const types = [["1", "Video"], ["2", "Audio"], ["3", "Subtitles"], ["4", "Something else"]];
    const seasonOptions = item.mediaType === "tv"
      ? [`<option value="0">All seasons</option>`, ...(item.seasons || [])
        .filter((season) => season.status === 4 || season.status === 5)
        .map((season) => `<option value="${season.seasonNumber}"${String(season.seasonNumber) === draft.season ? " selected" : ""}>${escapeHtml(season.title)}</option>`)]
      : [];

    return [
      `<form class="report-form" data-report-form="true">`,
      `<div class="filter-field"><label for="reportType">What's wrong?</label><select id="reportType" name="type">`,
      types.map(([value, label]) => `<option value="${value}"${value === draft.type ? " selected" : ""}>${label}</option>`).join(""),
      `</select></div>`,
      item.mediaType === "tv" ? [
        `<div class="report-row">`,
        `<div class="filter-field"><label for="reportSeason">Season</label><select id="reportSeason" name="season">${seasonOptions.join("")}</select></div>`,
        `<div class="filter-field"><label for="reportEpisode">Episode</label><input id="reportEpisode" name="episode" type="number" min="0" step="1" placeholder="All episodes" value="${escapeHtml(draft.episode)}"></div>`,
        `</div>`
      ].join("") : "",
      `<div class="filter-field"><label for="reportText">What happened?</label><textarea id="reportText" name="text" rows="4" maxlength="2000" placeholder="For example: no sound after 20 minutes, or subtitles are out of sync.">${escapeHtml(draft.text)}</textarea></div>`,
      report.error ? `<div class="report-error">${escapeHtml(report.error)}</div>` : "",
      `<div class="report-actions">`,
      `<button class="action secondary" type="button" data-report-cancel="true">Cancel</button>`,
      `<button class="action" type="submit"${report.sending ? " disabled" : ""}>${report.sending ? "Sending..." : "Send report"}</button>`,
      `</div>`,
      `</form>`
    ].join("");
  }

  function readReportForm(form) {
    if (!state.report || !form) return;
    state.report.draft = {
      type: form.elements.type?.value || "1",
      season: form.elements.season?.value || "0",
      episode: form.elements.episode?.value || "",
      text: form.elements.text?.value || ""
    };
  }

  async function sendReport(item) {
    const report = state.report;
    const draft = report.draft;
    if (!draft.text.trim()) {
      report.error = "Add a few words about what's wrong.";
      renderBody();
      return;
    }

    report.sending = true;
    report.error = "";
    renderBody();
    try {
      await apiPost("/Issue", {
        mediaInfoId: Number(item.mediaInfo.id),
        issueType: Number(draft.type),
        message: draft.text.trim(),
        problemSeason: item.mediaType === "tv" ? Number(draft.season) || 0 : 0,
        problemEpisode: item.mediaType === "tv" ? Math.max(0, Math.floor(Number(draft.episode) || 0)) : 0
      });
      state.report = { key: key(item), open: false, done: true };
    } catch (error) {
      report.sending = false;
      report.error = `The report didn't go through: ${error.message}`;
    }
    renderBody();
  }

  function renderRatings(item) {
    const ratings = [
      ...(Number(item.rating) > 0 ? [{ label: "TMDB", value: Number(item.rating).toFixed(1), url: "" }] : []),
      ...(state.extras?.ratings || [])
    ];
    if (!ratings.length) return "";

    return `<div class="ratings">${ratings.map((rating) => {
      const url = safeExternalUrl(rating.url);
      const content = `<span class="rating-label">${escapeHtml(rating.label)}</span> <span class="rating-value">${escapeHtml(rating.value)}</span>`;
      return url
        ? `<a class="rating" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${content}</a>`
        : `<span class="rating">${content}</span>`;
    }).join("")}</div>`;
  }

  function renderCast(item) {
    if (!item.cast?.length) return "";
    return [
      `<section class="extra-section">`,
      `<h3>Cast</h3>`,
      `<div class="cast-row">`,
      item.cast.map((person) => [
        `<div class="cast-member">`,
        person.profilePath
          ? `<img class="cast-photo" alt="" loading="lazy" src="https://image.tmdb.org/t/p/w185${escapeHtml(person.profilePath)}">`
          : `<div class="cast-photo cast-photo-fallback">${escapeHtml(initials(person.name))}</div>`,
        `<div class="cast-name">${escapeHtml(person.name)}</div>`,
        person.character ? `<div class="cast-character">${escapeHtml(person.character)}</div>` : "",
        `</div>`
      ].join("")).join(""),
      `</div>`,
      `</section>`
    ].join("");
  }

  function initials(name) {
    return String(name || "").split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  }

  function missingCollectionParts(collection) {
    return (collection?.parts || []).filter((part) => {
      const status = statusFor(part);
      return (status === "not available" || status === "deleted" || status.startsWith("error:")) && !state.pending.has(key(part));
    });
  }

  function renderCollection() {
    const collection = state.extras?.collection;
    if (!collection) return "";

    const missing = missingCollectionParts(collection);
    const available = collection.parts.filter((part) => statusFor(part) === "available").length;
    const requestsDisabled = state.status?.requestSubmissionEnabled === false;
    const busy = collection.parts.some((part) => state.pending.has(key(part)));
    const label = busy
      ? "Requesting..."
      : missing.length
        ? `Request ${missing.length} missing movie${missing.length === 1 ? "" : "s"}`
        : "Every movie is requested or available";
    const disabled = requestsDisabled || busy || !missing.length;

    return [
      `<section class="extra-section">`,
      `<h3>${escapeHtml(collection.name)}</h3>`,
      `<div class="status-note">${escapeHtml(collection.parts.length)} movies, ${escapeHtml(available)} available</div>`,
      `<button class="action detail-action${disabled ? " muted" : ""}" data-request-collection="true" ${disabled ? "disabled" : ""}>${escapeHtml(label)}</button>`,
      `<div class="grid">${collection.parts.map(renderCard).join("")}</div>`,
      `</section>`
    ].join("");
  }

  function renderRecommendations() {
    const items = state.extras?.recommendations || [];
    if (!items.length) return "";
    return [
      `<section class="extra-section">`,
      `<h3>You might also like</h3>`,
      `<div class="grid">${items.map(renderCard).join("")}</div>`,
      `</section>`
    ].join("");
  }

  // One at a time, so Jellyseerr isn't hit with a burst of requests and each card updates as it goes.
  async function requestCollection() {
    const missing = missingCollectionParts(state.extras?.collection);
    for (const part of missing) {
      await submit(part);
    }
  }

  function renderSeasonGrid(item) {
    if (!item.seasons?.length) {
      return `<div class="message">No season details found.</div>`;
    }

    return [
      `<section class="season-section">`,
      `<h3>Seasons</h3>`,
      `<div class="season-grid">`,
      item.seasons.map((season) => renderSeasonCard(item, season)).join(""),
      `</div>`,
      `</section>`
    ].join("");
  }

  function renderSeasonCard(show, season) {
    const action = actionForSeason(show, season);
    const status = statusForSeason(show, season);
    const payload = escapeHtml(JSON.stringify({ id: show.id, mediaType: "tv", seasonNumber: season.seasonNumber }));
    const year = (season.airDate || "").slice(0, 4);
    return [
      `<article class="season-card">`,
      poster({ ...season, title: season.title }, "season-poster"),
      `<div class="season-body">`,
      `<div class="name">${escapeHtml(season.title)}${year ? ` (${escapeHtml(year)})` : ""}</div>`,
      `<div class="status">${escapeHtml(season.episodeCount || "?")} episodes - ${escapeHtml(status)}</div>`,
      renderProgress(downloadsFor(show, season.seasonNumber), "tv"),
      `<button class="action${action.muted ? " muted" : ""}${action.error ? " error" : ""}" data-season-request="${payload}" ${action.disabled ? "disabled" : ""}>${escapeHtml(action.label)}</button>`,
      `</div>`,
      `</article>`
    ].join("");
  }

  function poster(item, className = "poster") {
    return item.posterPath
      ? `<img class="${escapeHtml(className)}" alt="" loading="lazy" src="https://image.tmdb.org/t/p/w500${escapeHtml(item.posterPath)}">`
      : `<div class="${escapeHtml(className)} poster-fallback">${escapeHtml(item.title)}</div>`;
  }

  // Jellyseerr's request status numbers: 1 waiting for approval, 2 approved, 3 declined,
  // 4 failed to send for download, 5 completed. Waiting and approved already show in the
  // title's status, so only the outcomes that need explaining are added here.
  function requestLine(item) {
    const request = item.bridgeRequest;
    if (!request) return "";

    const date = formatDate(request.createdAt);
    let text = date ? `Requested ${date}` : "Requested";
    const seasons = (request.seasons || []).filter((number) => number > 0);
    if (seasons.length) text += `, season${seasons.length === 1 ? "" : "s"} ${seasons.join(", ")}`;
    if (request.is4k) text += ", 4K";
    if (request.status === 3) text += ". Declined";
    if (request.status === 4) text += ". Couldn't be sent for download";
    return `<div class="request-line${request.status === 3 || request.status === 4 ? " problem" : ""}">${escapeHtml(text)}</div>`;
  }

  function renderCard(item) {
    const action = actionFor(item);
    const payload = escapeHtml(JSON.stringify({ id: item.id, mediaType: item.mediaType }));
    const status = statusFor(item);
    return [
      `<article class="card">`,
      `<button class="card-link" data-detail="${payload}" aria-label="Open ${escapeHtml(item.title)} details">`,
      poster(item),
      `<div class="card-body">`,
      `<div class="name">${escapeHtml(item.title)}${item.year ? ` (${escapeHtml(item.year)})` : ""}</div>`,
      `<div class="status">${escapeHtml(item.mediaType === "tv" ? "show" : "movie")} - ${escapeHtml(status)}</div>`,
      renderProgress(downloadsFor(item), item.mediaType),
      requestLine(item),
      `</div>`,
      `</button>`,
      `<div class="card-actions">`,
      renderOpenLink(item),
      status === "available" && jellyfinUrl(item)
        ? ""
        : `<button class="action${action.muted ? " muted" : ""}${action.error ? " error" : ""}" data-request="${payload}" ${action.disabled ? "disabled" : ""}>${escapeHtml(action.label)}</button>`,
      `</div>`,
      `</article>`
    ].join("");
  }

  function extraItems() {
    return [...(state.extras?.recommendations || []), ...(state.extras?.collection?.parts || [])];
  }

  function itemFromPayload(value) {
    if (state.detail?.id === value.id && state.detail?.mediaType === value.mediaType) return state.detail;
    return [...state.results, ...extraItems()].find((item) => item.id === value.id && item.mediaType === value.mediaType);
  }

  function bindEvents() {
    els.search.addEventListener("input", () => {
      state.query = els.search.value.trim();
      clearTimeout(state.searchTimer);
      state.searchTimer = setTimeout(() => {
        resetAndLoad();
      }, 350);
    });

    els.filterToggle.addEventListener("click", () => {
      const open = !els.filters.classList.contains("open");
      els.filters.classList.toggle("open", open);
      els.filterToggle.setAttribute("aria-expanded", String(open));
    });

    els.sortToggle.addEventListener("click", () => {
      const open = !els.sorts.classList.contains("open");
      els.sorts.classList.toggle("open", open);
      els.sortToggle.setAttribute("aria-expanded", String(open));
    });

    els.applyFilters.addEventListener("click", () => {
      readFilters();
      resetAndLoad();
    });

    els.clearFilters.addEventListener("click", () => {
      els.ratingFilter.value = "";
      els.releaseFromFilter.value = "";
      els.releaseToFilter.value = "";
      els.providerFilter.value = "";
      readFilters();
      resetAndLoad();
    });

    els.applySort.addEventListener("click", () => {
      readSort();
      resetAndLoad();
    });

    els.clearSort.addEventListener("click", () => {
      els.sortSelect.value = "";
      readSort();
      resetAndLoad();
    });

    document.addEventListener("click", (event) => {
      const detail = event.target.closest("[data-detail]");
      if (detail) {
        const item = itemFromPayload(JSON.parse(detail.getAttribute("data-detail")));
        if (item) loadDetail(item);
        return;
      }

      const request = event.target.closest("[data-request]");
      if (request) {
        const item = itemFromPayload(JSON.parse(request.getAttribute("data-request")));
        if (item) submit(item);
        return;
      }

      if (event.target.closest("[data-report-open]") && state.detail) {
        state.report = {
          key: key(state.detail),
          open: true,
          sending: false,
          error: "",
          draft: { type: "1", season: "0", episode: "", text: "" }
        };
        renderBody();
        document.getElementById("reportText")?.focus();
        return;
      }

      if (event.target.closest("[data-report-cancel]")) {
        state.report = null;
        renderBody();
        return;
      }

      if (event.target.closest("[data-request-collection]")) {
        requestCollection();
        return;
      }

      const seasonRequest = event.target.closest("[data-season-request]");
      if (seasonRequest) {
        const payload = JSON.parse(seasonRequest.getAttribute("data-season-request"));
        const item = itemFromPayload(payload);
        if (item) submit(item, payload.seasonNumber);
        return;
      }

      if (event.target.closest("[data-back]")) {
        state.detail = null;
        state.detailBase = null;
        state.extras = null;
        renderBody();
        return;
      }

      const category = event.target.closest("[data-category]");
      if (category) {
        state.category = category.getAttribute("data-category");
        state.query = "";
        els.search.value = "";
        resetAndLoad();
        return;
      }

      if (event.target.closest("[data-load-more]")) {
        loadResults({ append: true });
      }
    });

    document.addEventListener("input", (event) => {
      const form = event.target.closest?.("[data-report-form]");
      if (form) readReportForm(form);
    });
    document.addEventListener("change", (event) => {
      const form = event.target.closest?.("[data-report-form]");
      if (form) readReportForm(form);
    });
    document.addEventListener("submit", (event) => {
      const form = event.target.closest?.("[data-report-form]");
      if (!form) return;
      event.preventDefault();
      readReportForm(form);
      if (state.detail && !state.report?.sending) sendReport(state.detail);
    });

    window.addEventListener("scroll", () => {
      if (state.detailBase || !canLoadMore()) return;
      const remaining = document.documentElement.scrollHeight - window.innerHeight - window.scrollY;
      if (remaining < 700) {
        loadResults({ append: true });
      }
    }, { passive: true });
  }

  function fetchLatest(item) {
    return apiGet(item.mediaType === "tv" ? `/Tv/${item.id}` : `/Movie/${item.id}`);
  }

  // The same title can be in the results grid and open in the detail view at once, as
  // separate objects. Update all of them so going back to the grid shows the same thing.
  function copiesOf(item) {
    const copies = new Set([state.detail, state.detailBase, ...state.results, ...extraItems()]);
    return Array.from(copies).filter((candidate) => candidate && key(candidate) === key(item));
  }

  function applyLatest(item, detail) {
    let changed = false;
    for (const copy of copiesOf(item)) {
      const before = JSON.stringify([copy.mediaInfo, copy.seasons]);
      copy.mediaInfo = detail.mediaInfo || null;
      if (Array.isArray(copy.seasons)) copy.seasons = normalizeSeasons(detail, copy);
      if (JSON.stringify([copy.mediaInfo, copy.seasons]) !== before) changed = true;
    }

    // Jellyseerr now has the real status, so drop the "requested" placeholders. Errors stay.
    const prefix = key(item);
    for (const [localKey, value] of Array.from(state.local)) {
      if (value === "requested" && (localKey === prefix || localKey.startsWith(`${prefix}:`))) {
        state.local.delete(localKey);
        changed = true;
      }
    }
    return changed;
  }

  async function refreshTitles(items) {
    const results = await Promise.allSettled(items.map(async (item) => [item, await fetchLatest(item)]));
    let changed = false;
    for (const result of results) {
      if (result.status === "fulfilled" && applyLatest(...result.value)) changed = true;
    }
    if (changed) renderBody();
  }

  function isInProgress(item) {
    if (!item) return false;
    if (downloadsFor(item).length) return true;
    if (Array.from(state.local).some(([localKey, value]) => value === "requested" && (localKey === key(item) || localKey.startsWith(`${key(item)}:`)))) return true;

    const status = item.mediaInfo?.status;
    if (status === 2 || status === 3) return true;
    return (item.mediaInfo?.seasons || []).some((season) => season.status === 2 || season.status === 3);
  }

  function refreshInProgress() {
    if (document.hidden || state.loading || state.detailLoading) return;
    const visible = state.detailBase ? [state.detail || state.detailBase, ...extraItems()] : state.results;
    const targets = visible.filter(isInProgress).slice(0, MAX_REFRESH_PER_ROUND);
    if (targets.length) refreshTitles(targets);
  }

  function canLoadMore() {
    return Boolean(state.pageInfo && state.pageInfo.page < state.pageInfo.totalPages && !state.loading);
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  }

  bindEvents();
  renderTabs();
  loadStatus().finally(loadResults);
  loadQuota();
  setInterval(refreshInProgress, REFRESH_MS);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refreshInProgress();
  });
})();
