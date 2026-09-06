// edge-functions/api/plugins/weather.js
// 在 EdgeOne Pages 边缘节点上代理 Open-Meteo 全球气象服务，提供免 Key、高精度的实时天气与 7 日天气预报。

const GEOCODING_ENDPOINT = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_ENDPOINT = 'https://api.open-meteo.com/v1/forecast';

import { CORS, json, verifyUserToken } from '../_auth.js';

function decodeWmoCode(code) {
  const map = {
    0: '晴朗 (Clear sky)',
    1: '主要晴朗 (Mainly clear)',
    2: '多云 (Partly cloudy)',
    3: '阴天 (Overcast)',
    45: '有雾 (Fog)',
    48: '白霜雾 (Depositing rime fog)',
    51: '轻微小雨 (Light drizzle)',
    53: '中度细雨 (Moderate drizzle)',
    55: '密集细雨 (Dense drizzle)',
    61: '小雨 (Slight rain)',
    63: '中雨 (Moderate rain)',
    65: '大雨 (Heavy rain)',
    71: '小雪 (Slight snow)',
    73: '中雪 (Moderate snow)',
    75: '大雪 (Heavy snow)',
    80: '阵雨 (Rain showers)',
    81: '强阵雨 (Moderate rain showers)',
    82: '暴烈阵雨 (Violent rain showers)',
    95: '雷暴 (Thunderstorm)',
    96: '雷暴伴有轻微冰雹 (Thunderstorm with slight hail)',
    99: '强雷暴伴有大冰雹 (Thunderstorm with heavy hail)'
  };
  return map[code] || `气象代码 ${code}`;
}

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestPost(context) {
  try {
    const { request, env } = context;

    // 1. 统一门禁鉴权：通过 EdgeOne KV (ZENMUX_CHAT) 校验用户口令
    const auth = await verifyUserToken(request, env);
    if (!auth.ok) {
      return json({ error: auth.error }, auth.status);
    }

  let payload;
  try {
    payload = await request.json();
  } catch (e) {
    return json({ error: '请求体不是合法 JSON' }, 400);
  }

  const location = (payload && payload.location) ? String(payload.location).trim() : '';
  if (!location) {
    return json({ error: '缺少城市或地点 location 参数' }, 400);
  }

  // 2. 地理编码定位 (Geocoding)
  let geoRes;
  try {
    geoRes = await fetch(`${GEOCODING_ENDPOINT}?name=${encodeURIComponent(location)}&count=1&language=zh&format=json`);
  } catch (e) {
    return json({ error: '连接地理编码服务失败', detail: String(e && e.message) }, 502);
  }

  const geoData = await geoRes.json().catch(() => null);
  const place = (geoData && geoData.results && geoData.results[0]);
  if (!place) {
    return json({ error: `未找到地点【${location}】的地理经纬度坐标，请尝试提供更明确的城市名称。` }, 404);
  }

  const lat = place.latitude;
  const lon = place.longitude;
  const placeName = [place.name, place.admin1, place.country].filter(Boolean).join(', ');

  // 3. 气象预报查询 (Forecast)
  const weatherUrl = `${FORECAST_ENDPOINT}?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto`;

  let weatherRes;
  try {
    weatherRes = await fetch(weatherUrl);
  } catch (e) {
    return json({ error: '连接气象预报服务失败', detail: String(e && e.message) }, 502);
  }

  const wData = await weatherRes.json().catch(() => null);
  if (!wData || !wData.current) {
    return json({ error: '获取气象数据失败' }, 502);
  }

  const cur = wData.current;
  const daily = wData.daily || {};

  const dailyForecast = (daily.time || []).slice(0, 7).map((date, idx) => ({
    date,
    condition: decodeWmoCode(daily.weather_code ? daily.weather_code[idx] : 0),
    maxTemp: daily.temperature_2m_max ? `${daily.temperature_2m_max[idx]}°C` : 'N/A',
    minTemp: daily.temperature_2m_min ? `${daily.temperature_2m_min[idx]}°C` : 'N/A',
    precipitation: daily.precipitation_sum ? `${daily.precipitation_sum[idx]} mm` : '0 mm',
  }));

  return json({
    success: true,
    location: placeName,
    latitude: lat,
    longitude: lon,
    timezone: wData.timezone || 'UTC',
    current: {
      temperature: `${cur.temperature_2m}°C`,
      apparentTemperature: `${cur.apparent_temperature}°C`,
      humidity: `${cur.relative_humidity_2m}%`,
      windSpeed: `${cur.wind_speed_10m} km/h`,
      precipitation: `${cur.precipitation} mm`,
      condition: decodeWmoCode(cur.weather_code),
    },
    forecast: dailyForecast
  }, 200);
} catch (fatalErr) {
  return json({
    error: '气象网关内部异常',
    detail: String(fatalErr && fatalErr.message)
  }, 500);
}
}
