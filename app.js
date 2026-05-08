const CONFIG = {
  // Fixed location for ZIP 08701 (Lakewood, NJ).
  latitude: 40.0979,
  longitude: -74.2176,
  // Keep false to always use the fixed ZIP location above.
  useGeolocation: false,
  zipCode: "08701",
  // Keep null to follow the iPad/browser local timezone automatically.
  timezone: null,

  // Options: "nws", "tomorrow", "openmeteo", "auto"
  provider: "auto",

  // Required only for Tomorrow.io usage.
  tomorrowApiKey: "",
};

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
  dailyForecast: document.getElementById("daily-forecast"),
  status: document.getElementById("status"),
  lastUpdated: document.getElementById("last-updated"),
  locationName: document.getElementById("location-name"),
  sourceName: document.getElementById("source-name"),
};

const state = {
  latitude: CONFIG.latitude,
  longitude: CONFIG.longitude,
  isFetching: false,
};

function fetchNoCache(url) {
  const bustUrl = new URL(url);
  bustUrl.searchParams.set("_t", `${Date.now()}`);
  return fetch(bustUrl.toString(), { cache: "no-store" });
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

function formatDay(dateIso) {
  const timeZone = getTimeZone();
  return new Date(dateIso).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone,
  });
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

  const cards = data.hourly
    .slice(0, 8)
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

  el.forecast.innerHTML = cards;

  const dailyCards = data.daily
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

  el.dailyForecast.innerHTML = dailyCards;
}

function summarizeByMostFrequent(items) {
  const counts = new Map();
  for (const item of items) {
    counts.set(item, (counts.get(item) || 0) + 1);
  }
  let winner = items[0] || "Unavailable";
  let top = -1;
  for (const [name, count] of counts.entries()) {
    if (count > top) {
      top = count;
      winner = name;
    }
  }
  return winner;
}

function buildDailyFromHourly(hourlyPeriods) {
  const groups = new Map();
  for (const period of hourlyPeriods.slice(0, 24 * 5)) {
    const key = period.startTime.slice(0, 10);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(period);
  }

  return [...groups.values()].slice(0, 5).map((entries) => {
    const temps = entries.map((e) => e.temperature).filter((t) => Number.isFinite(t));
    const summaries = entries.map((e) => e.shortForecast || "Unavailable");
    return {
      time: entries[0].startTime,
      high: Math.max(...temps),
      low: Math.min(...temps),
      unit: entries[0].temperatureUnit || "F",
      summary: summarizeByMostFrequent(summaries),
    };
  });
}

async function getNwsWeather() {
  const pointUrl = `https://api.weather.gov/points/${state.latitude},${state.longitude}`;
  const pointRes = await fetchNoCache(pointUrl);
  if (!pointRes.ok) {
    throw new Error(`NWS points lookup failed (${pointRes.status})`);
  }
  const pointData = await pointRes.json();
  const rel = pointData?.properties?.relativeLocation?.properties;
  const locationText = rel?.city && rel?.state
    ? `${rel.city}, ${rel.state} (ZIP ${CONFIG.zipCode})`
    : `ZIP ${CONFIG.zipCode} (${state.latitude.toFixed(4)}, ${state.longitude.toFixed(4)})`;
  const hourlyUrl = pointData.properties.forecastHourly;
  if (!hourlyUrl) {
    throw new Error("NWS hourly forecast URL not available for this location");
  }

  const hourlyRes = await fetchNoCache(hourlyUrl);
  if (!hourlyRes.ok) {
    throw new Error(`NWS hourly forecast failed (${hourlyRes.status})`);
  }
  const hourlyData = await hourlyRes.json();
  const periods = hourlyData.properties?.periods ?? [];
  if (periods.length === 0) {
    throw new Error("NWS hourly forecast returned no periods");
  }

  const current = periods[0];
  return {
    source: "National Weather Service",
    location: locationText,
    current: {
      temperature: current.temperature,
      unit: current.temperatureUnit || "F",
      summary: current.shortForecast || "Unavailable",
    },
    hourly: periods.slice(0, 8).map((p) => ({
      time: p.startTime,
      temperature: p.temperature,
      unit: p.temperatureUnit || "F",
      summary: p.shortForecast || "Unavailable",
    })),
    daily: buildDailyFromHourly(periods),
  };
}

async function getTomorrowWeather() {
  if (!CONFIG.tomorrowApiKey) {
    throw new Error("Tomorrow.io selected but API key is missing");
  }

  const params = new URLSearchParams({
    location: `${state.latitude},${state.longitude}`,
    units: "imperial",
    timesteps: "1h,1d",
    fields: "temperature,temperatureMax,temperatureMin,weatherCode",
    apikey: CONFIG.tomorrowApiKey,
  });

  const url = `https://api.tomorrow.io/v4/weather/forecast?${params.toString()}`;
  const res = await fetchNoCache(url);
  if (!res.ok) {
    throw new Error(`Tomorrow.io forecast failed (${res.status})`);
  }

  const data = await res.json();
  const hourly = data?.timelines?.hourly ?? [];
  const daily = data?.timelines?.daily ?? [];
  if (hourly.length === 0) {
    throw new Error("Tomorrow.io returned no hourly data");
  }
  if (daily.length === 0) {
    throw new Error("Tomorrow.io returned no daily data");
  }

  const mapTomorrowCode = (code) => {
    const weatherCodeMap = {
      1000: "Clear",
      1100: "Mostly Clear",
      1101: "Partly Cloudy",
      1102: "Mostly Cloudy",
      1001: "Cloudy",
      4000: "Drizzle",
      4001: "Rain",
      4200: "Light Rain",
      4201: "Heavy Rain",
      5000: "Snow",
      5100: "Light Snow",
      5101: "Heavy Snow",
      8000: "Thunderstorm",
    };
    return weatherCodeMap[code] || "Unknown";
  };

  const current = hourly[0];
  return {
    source: "Tomorrow.io",
    location: `ZIP ${CONFIG.zipCode} (${state.latitude.toFixed(4)}, ${state.longitude.toFixed(4)})`,
    current: {
      temperature: current.values.temperature,
      unit: "F",
      summary: mapTomorrowCode(current.values.weatherCode),
    },
    hourly: hourly.slice(0, 8).map((entry) => ({
      time: entry.time,
      temperature: entry.values.temperature,
      unit: "F",
      summary: mapTomorrowCode(entry.values.weatherCode),
    })),
    daily: daily.slice(0, 5).map((entry) => ({
      time: entry.time,
      high: entry.values.temperatureMax,
      low: entry.values.temperatureMin,
      unit: "F",
      summary: mapTomorrowCode(entry.values.weatherCode),
    })),
  };
}

function mapOpenMeteoCode(code) {
  const map = {
    0: "Clear",
    1: "Mostly Clear",
    2: "Partly Cloudy",
    3: "Cloudy",
    45: "Fog",
    48: "Fog",
    51: "Drizzle",
    53: "Drizzle",
    55: "Drizzle",
    61: "Rain",
    63: "Rain",
    65: "Heavy Rain",
    66: "Freezing Rain",
    67: "Freezing Rain",
    71: "Snow",
    73: "Snow",
    75: "Heavy Snow",
    77: "Snow",
    80: "Rain Showers",
    81: "Rain Showers",
    82: "Heavy Rain Showers",
    85: "Snow Showers",
    86: "Heavy Snow Showers",
    95: "Thunderstorm",
    96: "Thunderstorm",
    99: "Thunderstorm",
  };
  return map[code] || "Unknown";
}

async function getOpenMeteoWeather() {
  const params = new URLSearchParams({
    latitude: `${state.latitude}`,
    longitude: `${state.longitude}`,
    current: "temperature_2m,weather_code",
    hourly: "temperature_2m,weather_code",
    daily: "temperature_2m_max,temperature_2m_min,weather_code",
    temperature_unit: "fahrenheit",
    timezone: "auto",
    forecast_days: "5",
  });

  const url = `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
  const res = await fetchNoCache(url);
  if (!res.ok) {
    throw new Error(`Open-Meteo forecast failed (${res.status})`);
  }

  const data = await res.json();
  const currentTemp = data?.current?.temperature_2m;
  const currentCode = data?.current?.weather_code;
  const hourlyTimes = data?.hourly?.time ?? [];
  const hourlyTemps = data?.hourly?.temperature_2m ?? [];
  const hourlyCodes = data?.hourly?.weather_code ?? [];
  const dailyTimes = data?.daily?.time ?? [];
  const dailyHighs = data?.daily?.temperature_2m_max ?? [];
  const dailyLows = data?.daily?.temperature_2m_min ?? [];
  const dailyCodes = data?.daily?.weather_code ?? [];

  if (!Number.isFinite(currentTemp) || hourlyTimes.length === 0 || dailyTimes.length === 0) {
    throw new Error("Open-Meteo returned incomplete forecast data");
  }

  return {
    source: "Open-Meteo",
    location: `ZIP ${CONFIG.zipCode} (${state.latitude.toFixed(4)}, ${state.longitude.toFixed(4)})`,
    current: {
      temperature: currentTemp,
      unit: "F",
      summary: mapOpenMeteoCode(currentCode),
    },
    hourly: hourlyTimes.slice(0, 8).map((time, idx) => ({
      time,
      temperature: hourlyTemps[idx],
      unit: "F",
      summary: mapOpenMeteoCode(hourlyCodes[idx]),
    })),
    daily: dailyTimes.slice(0, 5).map((time, idx) => ({
      time,
      high: dailyHighs[idx],
      low: dailyLows[idx],
      unit: "F",
      summary: mapOpenMeteoCode(dailyCodes[idx]),
    })),
  };
}

async function fetchWeather() {
  if (state.isFetching) return;
  state.isFetching = true;

  try {
    const location = await resolveLocation();
    state.latitude = location.latitude;
    state.longitude = location.longitude;

    const options = [];
    if (CONFIG.provider === "nws") {
      options.push(getNwsWeather);
    } else if (CONFIG.provider === "tomorrow") {
      if (CONFIG.tomorrowApiKey) {
        options.push(getTomorrowWeather);
      }
      options.push(getOpenMeteoWeather);
      options.push(getNwsWeather);
    } else if (CONFIG.provider === "openmeteo") {
      options.push(getOpenMeteoWeather);
      options.push(getNwsWeather);
    } else if (CONFIG.provider === "auto") {
      if (CONFIG.tomorrowApiKey) {
        options.push(getTomorrowWeather);
      }
      options.push(getOpenMeteoWeather);
      options.push(getNwsWeather);
    }

    let lastError = null;
    for (const load of options) {
      try {
        const data = await load();
        renderWeather(data);
        el.status.textContent = "";
        return true;
      } catch (err) {
        lastError = err;
      }
    }

    el.status.textContent = `Weather update failed: ${lastError?.message || "Unknown error"}`;
    return false;
  } finally {
    state.isFetching = false;
  }
}

function init() {
  formatDateTime();
  setInterval(formatDateTime, 1000);

  fetchWeather();
  setInterval(async () => {
    const ok = await fetchWeather();
    if (ok) return;
    // Retry more quickly when a provider is temporarily unavailable.
    setTimeout(fetchWeather, RETRY_INTERVAL_MS);
  }, REFRESH_INTERVAL_MS);

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      fetchWeather();
    }
  });
}

init();
