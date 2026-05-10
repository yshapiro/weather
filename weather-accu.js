const CONFIG = {
  latitude: 40.0979,
  longitude: -74.2176,
  useGeolocation: false,
  zipCode: "08701",
  timezone: null,

  // Optional: paste key here only in a private copy (visible in page source).
  // Prefer: save once via on-page form on GitHub / iPad → stored in localStorage for this URL only.
  accuWeatherApiKey: "",
};

function getAccuWeatherApiKey() {
  if (typeof window !== "undefined" && window.__ACCUWEATHER_API_KEY__) {
    return String(window.__ACCUWEATHER_API_KEY__);
  }
  try {
    const stored = localStorage.getItem("weatherAccuWeatherApiKey");
    if (stored) return stored;
  } catch {
    /* ignore */
  }
  return CONFIG.accuWeatherApiKey || "";
}

const WEATHER_ICONS = [
  { test: /sunny|clear/i, icon: "☀️" },
  { test: /partly|mostly sunny/i, icon: "⛅" },
  { test: /cloud/i, icon: "☁️" },
  { test: /rain|shower|drizzle/i, icon: "🌧️" },
  { test: /thunder|storm/i, icon: "⛈️" },
  { test: /snow|sleet|flurr/i, icon: "❄️" },
  { test: /fog|haze|smoke/i, icon: "🌫️" },
  { test: /wind/i, icon: "💨" },
];

const REFRESH_INTERVAL_MS = 15 * 60 * 1000;
const RETRY_INTERVAL_MS = 60 * 1000;

const el = {
  time: document.getElementById("current-time"),
  date: document.getElementById("current-date"),
  icon: document.getElementById("current-icon"),
  temp: document.getElementById("current-temp"),
  summary: document.getElementById("current-summary"),
  forecast: document.getElementById("hourly-forecast"),
  forecast2: document.getElementById("hourly-forecast-2"),
  dailyForecast: document.getElementById("daily-forecast"),
  status: document.getElementById("status"),
  lastUpdated: document.getElementById("last-updated"),
  locationName: document.getElementById("location-name"),
  sourceName: document.getElementById("source-name"),
  apiSetup: document.getElementById("api-setup"),
  apiKeyInput: document.getElementById("api-key-input"),
  apiKeySave: document.getElementById("api-key-save"),
};

const state = {
  latitude: CONFIG.latitude,
  longitude: CONFIG.longitude,
  isFetching: false,
  accuLocationCache: null,
};

function resetWeatherUi() {
  el.icon.textContent = "--";
  el.temp.textContent = "--°";
  el.summary.textContent = "—";
  el.sourceName.textContent = "Source: AccuWeather (not loaded)";
  if (el.locationName) el.locationName.textContent = "Location: —";
  el.lastUpdated.textContent = "Last updated: —";
  el.forecast.innerHTML = "";
  if (el.forecast2) el.forecast2.innerHTML = "";
  el.dailyForecast.innerHTML = "";
}

function resolveLocation() {
  if (!CONFIG.useGeolocation || !("geolocation" in navigator)) {
    return Promise.resolve({ latitude: CONFIG.latitude, longitude: CONFIG.longitude });
  }

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
      },
      () => {
        resolve({ latitude: CONFIG.latitude, longitude: CONFIG.longitude });
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 5 * 60 * 1000 }
    );
  });
}

function getTimeZone() {
  return CONFIG.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function pickIcon(summaryText) {
  for (const item of WEATHER_ICONS) {
    if (item.test.test(summaryText)) return item.icon;
  }
  return "🌤️";
}

function formatDateTime() {
  const now = new Date();
  const timeZone = getTimeZone();
  el.time.textContent = now.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
    timeZone,
  });
  el.date.textContent = now.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone,
  });
}

function formatHour(dateIso) {
  const timeZone = getTimeZone();
  return new Date(dateIso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone,
  });
}

function parseDateSafe(dateText) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateText)) {
    const [year, month, day] = dateText.split("-").map(Number);
    return new Date(year, month - 1, day, 12, 0, 0);
  }
  return new Date(dateText);
}

function formatDay(dateIso) {
  const timeZone = getTimeZone();
  return parseDateSafe(dateIso).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone,
  });
}

function getNextHourlyWindow(hourlyEntries, count = 8) {
  const nowMs = Date.now();
  const sorted = (hourlyEntries || [])
    .filter((hour) => Number.isFinite(hour?.temperature) && hour?.time)
    .map((hour) => ({ ...hour, _ms: parseDateSafe(hour.time).getTime() }))
    .filter((hour) => Number.isFinite(hour._ms))
    .sort((a, b) => a._ms - b._ms);

  if (sorted.length === 0) return [];

  const startIdx = sorted.findIndex((hour) => hour._ms >= nowMs);
  const safeStart = startIdx === -1 ? Math.max(0, sorted.length - count) : startIdx;
  return sorted.slice(safeStart, safeStart + count);
}

function renderWeather(data) {
  const timeZone = getTimeZone();
  const currentIcon = pickIcon(data.current.summary);
  el.icon.textContent = currentIcon;
  el.temp.textContent = `${Math.round(data.current.temperature)}°${data.current.unit}`;
  el.summary.textContent = data.current.summary;
  el.sourceName.textContent = `Source: ${data.source}`;
  if (el.locationName) {
    el.locationName.textContent = `Location: ${data.location || `ZIP ${CONFIG.zipCode}`}`;
  }
  el.lastUpdated.textContent = `Last updated: ${new Date().toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone,
  })}`;

  const nextHourly = getNextHourlyWindow(data.hourly, 12);
  const firstRow = nextHourly.slice(0, 6);
  const secondRow = nextHourly.slice(6, 12);

  el.forecast.innerHTML = firstRow
    .map((hour) => {
      const icon = pickIcon(hour.summary);
      return `
        <article class="forecast-item">
          <p class="forecast-time">${formatHour(hour.time)}</p>
          <p class="forecast-icon" aria-hidden="true">${icon}</p>
          <p class="forecast-temp">${Math.round(hour.temperature)}°${hour.unit}</p>
          <p class="forecast-summary">${hour.summary}</p>
        </article>
      `;
    })
    .join("");

  if (el.forecast2) {
    el.forecast2.innerHTML = secondRow
      .map((hour) => {
        const icon = pickIcon(hour.summary);
        return `
        <article class="forecast-item">
          <p class="forecast-time">${formatHour(hour.time)}</p>
          <p class="forecast-icon" aria-hidden="true">${icon}</p>
          <p class="forecast-temp">${Math.round(hour.temperature)}°${hour.unit}</p>
          <p class="forecast-summary">${hour.summary}</p>
        </article>
      `;
      })
      .join("");
  }

  el.dailyForecast.innerHTML = data.daily
    .slice(0, 5)
    .map((day) => {
      const icon = pickIcon(day.summary);
      const lowText = Number.isFinite(day.low) ? ` / ${Math.round(day.low)}°${day.unit}` : "";
      return `
        <article class="forecast-item">
          <p class="forecast-time">${formatDay(day.time)}</p>
          <p class="forecast-icon" aria-hidden="true">${icon}</p>
          <p class="forecast-hi-lo">${Math.round(day.high)}°${day.unit}${lowText}</p>
          <p class="forecast-summary">${day.summary}</p>
        </article>
      `;
    })
    .join("");
}

async function accuWeatherFetch(path, extraParams = {}) {
  const apiKey = getAccuWeatherApiKey();

  const buildUrl = (includeApiKeyQuery) => {
    const url = new URL(`https://dataservice.accuweather.com${path}`);
    for (const [k, v] of Object.entries(extraParams)) {
      url.searchParams.set(k, String(v));
    }
    url.searchParams.set("_t", `${Date.now()}`);
    if (includeApiKeyQuery) url.searchParams.set("apikey", apiKey);
    return url.toString();
  };

  const attemptFetch = async (mode) => {
    const url = buildUrl(mode === "query");
    const opts = { cache: "no-store" };
    if (mode === "bearer") {
      opts.headers = { Authorization: `Bearer ${apiKey}` };
    }
    return fetch(url, opts);
  };

  let res = await attemptFetch("query");
  if (res.status === 401 || res.status === 403) {
    res = await attemptFetch("bearer");
  }
  return res;
}

async function accuWeatherResolveLocation() {
  const cache = state.accuLocationCache;
  if (
    cache &&
    cache.lat === state.latitude &&
    cache.lon === state.longitude &&
    cache.key
  ) {
    return cache;
  }

  const res = await accuWeatherFetch("/locations/v1/cities/geoposition/search", {
    q: `${state.latitude},${state.longitude}`,
  });
  if (!res.ok) {
    throw new Error(`AccuWeather location lookup failed (${res.status})`);
  }
  const data = await res.json();
  const root = Array.isArray(data) ? data[0] : data;
  if (!root?.Key) {
    throw new Error("AccuWeather returned no location key");
  }
  const admin = root.AdministrativeArea?.LocalizedName || root.AdministrativeArea?.ID || "";
  const label = [root.LocalizedName, admin].filter(Boolean).join(", ");
  state.accuLocationCache = {
    lat: state.latitude,
    lon: state.longitude,
    key: root.Key,
    label: label || `ZIP ${CONFIG.zipCode}`,
  };
  return state.accuLocationCache;
}

async function getAccuWeather() {
  const { key, label } = await accuWeatherResolveLocation();

  const hourlyParams = { metric: "false", details: "false" };

  const [curRes, dailyRes] = await Promise.all([
    accuWeatherFetch(`/currentconditions/v1/${key}`, { details: "false" }),
    accuWeatherFetch(`/forecasts/v1/daily/5day/${key}`, hourlyParams),
  ]);

  let hourlyRes = await accuWeatherFetch(
    `/forecasts/v1/hourly/12hour/${key}`,
    hourlyParams
  );
  if (!hourlyRes.ok && hourlyRes.status === 403) {
    hourlyRes = await accuWeatherFetch(
      `/forecasts/v1/hourly/24hour/${key}`,
      hourlyParams
    );
  }

  if (!curRes.ok) {
    throw new Error(`AccuWeather current conditions failed (${curRes.status})`);
  }
  if (!hourlyRes.ok) {
    const hint403 =
      hourlyRes.status === 403
        ? " Your key may not include Hourly Forecasts—in developer.accuweather.com open My Apps → your app → Subscriptions and add/enabled Hourly Forecasts (or upgrade the plan)."
        : "";
    throw new Error(`AccuWeather hourly forecast failed (${hourlyRes.status}).${hint403}`);
  }
  if (!dailyRes.ok) {
    throw new Error(`AccuWeather daily forecast failed (${dailyRes.status})`);
  }

  const currentArr = await curRes.json();
  const hourlyArr = await hourlyRes.json();
  const dailyJson = await dailyRes.json();

  const cur0 = Array.isArray(currentArr) ? currentArr[0] : currentArr;
  if (!cur0) {
    throw new Error("AccuWeather returned no current conditions");
  }

  const tempImp = cur0.Temperature?.Imperial || cur0.Temperature?.Metric;
  const currentTemp = tempImp?.Value;
  const unit = tempImp?.Unit || "F";
  const summary = cur0.WeatherText || "Unavailable";

  const hourlyRaw = Array.isArray(hourlyArr) ? hourlyArr : [];
  const hourly = hourlyRaw.slice(0, 72).map((h) => {
    const t = h.Temperature;
    const val =
      typeof t?.Value === "number"
        ? t.Value
        : t?.Imperial?.Value ?? t?.Metric?.Value;
    const u = t?.Unit || t?.Imperial?.Unit || t?.Metric?.Unit || "F";
    return {
      time: h.DateTime,
      temperature: val,
      unit: u,
      summary: h.IconPhrase || h.ShortPhrase || "Unavailable",
    };
  });

  const dailyForecasts = dailyJson.DailyForecasts || [];
  const daily = dailyForecasts.slice(0, 5).map((d) => ({
    time: d.Date,
    high: d.Temperature?.Maximum?.Value,
    low: d.Temperature?.Minimum?.Value,
    unit: d.Temperature?.Maximum?.Unit || "F",
    summary: d.Day?.IconPhrase || d.Night?.IconPhrase || "Unavailable",
  }));

  if (!Number.isFinite(currentTemp) || hourly.length === 0 || daily.length === 0) {
    throw new Error("AccuWeather returned incomplete forecast data");
  }

  return {
    source: "AccuWeather",
    location: `${label} (ZIP ${CONFIG.zipCode})`,
    current: {
      temperature: currentTemp,
      unit,
      summary,
    },
    hourly,
    daily,
  };
}

async function fetchWeather() {
  if (state.isFetching) return;
  state.isFetching = true;

  try {
    const location = await resolveLocation();
    state.latitude = location.latitude;
    state.longitude = location.longitude;

    const key = getAccuWeatherApiKey();
    if (!key) {
      resetWeatherUi();
      el.status.textContent =
        "Weather unavailable: add your AccuWeather API key below, or set CONFIG.accuWeatherApiKey / window.__ACCUWEATHER_API_KEY__.";
      if (el.apiSetup) el.apiSetup.hidden = false;
      return false;
    }

    if (el.apiSetup) el.apiSetup.hidden = true;

    const data = await getAccuWeather();
    renderWeather(data);
    el.status.textContent = "";
    return true;
  } catch (err) {
    resetWeatherUi();
    el.status.textContent = `Weather unavailable: ${err?.message || "Unknown error"}`;
    return false;
  } finally {
    state.isFetching = false;
  }
}

function init() {
  formatDateTime();
  setInterval(formatDateTime, 1000);

  if (el.apiKeySave && el.apiKeyInput) {
    const saveKey = () => {
      const v = el.apiKeyInput.value.trim();
      if (!v) return;
      try {
        localStorage.setItem("weatherAccuWeatherApiKey", v);
      } catch {
        el.status.textContent = "Could not save key (storage blocked).";
        return;
      }
      el.apiKeyInput.value = "";
      if (el.apiSetup) el.apiSetup.hidden = true;
      fetchWeather();
    };
    el.apiKeySave.addEventListener("click", saveKey);
    el.apiKeyInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") saveKey();
    });
  }

  fetchWeather();
  setInterval(async () => {
    const ok = await fetchWeather();
    if (ok) return;
    setTimeout(fetchWeather, RETRY_INTERVAL_MS);
  }, REFRESH_INTERVAL_MS);

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      fetchWeather();
    }
  });
}

init();
