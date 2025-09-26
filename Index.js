require("dotenv").config();
const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const fetch = (...args) => import("node-fetch").then(({ default: fetch }) => fetch(...args));

const TMDB_API_KEY = process.env.TMDB_API_KEY;
const TRAKT_KEY = process.env.TRAKT_KEY;
const TMDB_BASE = "https://api.themoviedb.org/3";

const manifest = require("./manifest.json");
const builder = new addonBuilder(manifest);

// ------------------ Helpers ------------------
async function fetchTrending(type, page = 1, pageSize = 20) {
    try {
        const url = type === "movie"
            ? `https://api.trakt.tv/movies/trending?page=${page}&limit=${pageSize}`
            : `https://api.trakt.tv/shows/trending?page=${page}&limit=${pageSize}`;
        const res = await fetch(url, {
            headers: { "trakt-api-key": TRAKT_KEY, "trakt-api-version": "2" }
        });
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) return { items: data, source: "trakt" };
    } catch (err) {
        console.warn("Trakt trending failed, fallback to TMDb:", err?.message || err);
    }

    const tmdbUrl = type === "movie"
        ? `${TMDB_BASE}/trending/movie/week?api_key=${TMDB_API_KEY}&page=${page}`
        : `${TMDB_BASE}/trending/tv/week?api_key=${TMDB_API_KEY}&page=${page}`;
    const res2 = await fetch(tmdbUrl);
    const data2 = await res2.json();
    return { items: data2.results || [], source: "tmdb" };
}

const filterBlocked = metas => metas.filter(m => !`${m.name || ""} ${m.description || ""}`.toLowerCase().includes("ullu"));

async function mapToMeta(item, type, source, catalogId) {
    let id = "";
    let tmdbId = "";
    let name = "";
    let poster = null;
    let backdrop = null;
    let description = "";
    let releaseInfo = "";

    if (source === "trakt") {
        // Trakt items (already have IMDb IDs)
        const node = catalogId.includes("movie") ? item.movie : item.show;
        tmdbId = node?.ids?.tmdb;
        id = node?.ids?.imdb || (tmdbId ? `tmdb:${tmdbId}` : undefined);
        name = node?.title || node?.name || "Untitled";
        description = node?.overview || "";
        releaseInfo = node?.year || "";
        if (tmdbId) {
            try {
                const tmdbRes = await fetch(`${TMDB_BASE}/${type === "movie" ? "movie" : "tv"}/${tmdbId}?api_key=${TMDB_API_KEY}`);
                const tmdbData = await tmdbRes.json();
                poster = tmdbData.poster_path ? `https://image.tmdb.org/t/p/w500${tmdbData.poster_path}` : null;
                backdrop = tmdbData.backdrop_path ? `https://image.tmdb.org/t/p/w780${tmdbData.backdrop_path}` : null;
                if (tmdbData.imdb_id) id = tmdbData.imdb_id;
            } catch {}
        }
    } else {
        // TMDb items
        tmdbId = item.id;
        name = item.title || item.name || "Untitled";
        description = item.overview || "";
        releaseInfo = item.release_date || item.first_air_date || "";

        try {
            if (type === "movie") {
                const tmdbRes = await fetch(`${TMDB_BASE}/movie/${tmdbId}?api_key=${TMDB_API_KEY}`);
                const tmdbData = await tmdbRes.json();
                id = tmdbData.imdb_id || `tmdb:${tmdbId}`;
                poster = tmdbData.poster_path ? `https://image.tmdb.org/t/p/w500${tmdbData.poster_path}` : null;
                backdrop = tmdbData.backdrop_path ? `https://image.tmdb.org/t/p/w780${tmdbData.backdrop_path}` : null;
            } else if (type === "series") {
                // For TV shows, fetch external_ids to get IMDb ID
                const extRes = await fetch(`${TMDB_BASE}/tv/${tmdbId}/external_ids?api_key=${TMDB_API_KEY}`);
                const external = await extRes.json();
                id = external.imdb_id || `tmdb:${tmdbId}`;

                // Fetch poster/backdrop separately
                const tmdbDataRes = await fetch(`${TMDB_BASE}/tv/${tmdbId}?api_key=${TMDB_API_KEY}`);
                const tmdbData = await tmdbDataRes.json();
                poster = tmdbData.poster_path ? `https://image.tmdb.org/t/p/w500${tmdbData.poster_path}` : null;
                backdrop = tmdbData.backdrop_path ? `https://image.tmdb.org/t/p/w780${tmdbData.backdrop_path}` : null;
            }
        } catch {
            id = `tmdb:${tmdbId}`;
            poster = item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : null;
            backdrop = item.backdrop_path ? `https://image.tmdb.org/t/p/w780${item.backdrop_path}` : null;
        }
    }

    return {
        id,
        type,
        name,
        poster,
        background: backdrop,
        description,
        releaseInfo
    };
}


// TMDb endpoints
const tmdbEndpoints = {
    top_rated_movies: `${TMDB_BASE}/movie/top_rated?api_key=${TMDB_API_KEY}&page=1`,
    top_rated_series: `${TMDB_BASE}/tv/top_rated?api_key=${TMDB_API_KEY}&page=1`,
    tv_popular: `${TMDB_BASE}/tv/popular?api_key=${TMDB_API_KEY}&page=1`,
    action_movies: `${TMDB_BASE}/discover/movie?api_key=${TMDB_API_KEY}&with_genres=28,12&page=1`,
    comedy_movies: `${TMDB_BASE}/discover/movie?api_key=${TMDB_API_KEY}&with_genres=35&page=1`,
    drama_movies: `${TMDB_BASE}/discover/movie?api_key=${TMDB_API_KEY}&with_genres=18&page=1`,
    horror_movies: `${TMDB_BASE}/discover/movie?api_key=${TMDB_API_KEY}&with_genres=27,9648&page=1`,
    scifi_movies: `${TMDB_BASE}/discover/movie?api_key=${TMDB_API_KEY}&with_genres=878,14&page=1`,
    crime_movies: `${TMDB_BASE}/discover/movie?api_key=${TMDB_API_KEY}&with_genres=80,53&page=1`,
    tv_action: `${TMDB_BASE}/discover/tv?api_key=${TMDB_API_KEY}&with_genres=10759&page=1`,
    tv_comedy: `${TMDB_BASE}/discover/tv?api_key=${TMDB_API_KEY}&with_genres=35&page=1`,
    tv_drama: `${TMDB_BASE}/discover/tv?api_key=${TMDB_API_KEY}&with_genres=18&page=1`,
    tv_horror: `${TMDB_BASE}/discover/tv?api_key=${TMDB_API_KEY}&with_genres=9648,10768&page=1`,
    tv_scifi: `${TMDB_BASE}/discover/tv?api_key=${TMDB_API_KEY}&with_genres=10765&page=1`,
    tv_crime: `${TMDB_BASE}/discover/tv?api_key=${TMDB_API_KEY}&with_genres=80,9648&page=1`,
    indian_movies: `${TMDB_BASE}/discover/movie?api_key=${TMDB_API_KEY}&with_origin_country=IN&without_networks=3873&page=1`,
    indian_series: `${TMDB_BASE}/discover/tv?api_key=${TMDB_API_KEY}&with_origin_country=IN&without_networks=3873&page=1`,
    kdramas: `${TMDB_BASE}/discover/tv?api_key=${TMDB_API_KEY}&with_original_language=ko&page=1`,
    us_tv: `${TMDB_BASE}/discover/tv?api_key=${TMDB_API_KEY}&with_origin_country=US&page=1`,
    uk_tv: `${TMDB_BASE}/discover/tv?api_key=${TMDB_API_KEY}&with_origin_country=GB&page=1`
};

// ------------------ Catalog Handler ------------------
builder.defineCatalogHandler(async ({ type, id, extra }) => {
    const pageSize = 20;
    const skip = Number(extra?.skip || 0);
    const page = Math.floor(skip / pageSize) + 1;
    const offset = skip % pageSize;

    let items = [], source = "tmdb";
    let url = "";

    switch (id) {
        case "trending_movies": ({ items, source } = await fetchTrending("movie", page, pageSize)); break;
        case "trending_series": ({ items, source } = await fetchTrending("series", page, pageSize)); break;
        default: url = tmdbEndpoints[id] || "";
    }

    if (!items.length && url) {
        url = url.replace(/page=\d+/, `page=${page}`);
        const res = await fetch(url);
        const data = await res.json();
        items = data.results || [];
        items = items.slice(offset, offset + pageSize);
    }

    const metas = await Promise.all(items.map(item => mapToMeta(item, type, source, id)));
    return { metas: filterBlocked(metas) };
});

// ------------------ Meta Handler ------------------
builder.defineMetaHandler(async ({ type, id }) => {
    if (id.startsWith("tmdb:")) {
        const tmdbId = id.split(":")[1];
        const endpoint = type === "movie" ? "movie" : "tv";
        try {
            const res = await fetch(`${TMDB_BASE}/${endpoint}/${tmdbId}?api_key=${TMDB_API_KEY}`);
            const data = await res.json();
            return { meta: await mapToMeta(data, type, "tmdb", id) };
        } catch (err) {
            console.error("Failed to fetch meta for", id, err.message);
        }
    }
    return { meta: {} };
});

// ------------------ Serve HTTP ------------------
serveHTTP(builder.getInterface(), { port: 7000 });
console.log("Mega Catalog addon running at http://127.0.0.1:7000/manifest.json");
