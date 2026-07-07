// APIs públicas e gratuitas (chamadas do navegador do usuário):
// - Nominatim/OSM: geocodificação
// - Open-Meteo: meteorologia (indicativa; decisão final = piloto + METAR oficial)
// - OSRM (servidor demo): rotas terrestres, sem trânsito em tempo real
// - Overpass/OSM: áreas candidatas a pouso e obstáculos
// - AviationWeather.gov: METAR SBSV (melhor esforço)

function signal(ms) {
  const c = new AbortController()
  setTimeout(() => c.abort(), ms)
  return c.signal
}

async function getJSON(url, ms = 20000) {
  const r = await fetch(url, { signal: signal(ms) })
  if (!r.ok) throw new Error('HTTP ' + r.status)
  return r.json()
}

export async function geocode(q) {
  const u = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&countrycodes=br&accept-language=pt-BR&q=${encodeURIComponent(q)}`
  const j = await getJSON(u)
  return j
    .map((r) => ({ lat: +r.lat, lon: +r.lon, label: r.display_name }))
    .sort((a, b) => (b.label.includes('Bahia') ? 1 : 0) - (a.label.includes('Bahia') ? 1 : 0))
}

export async function reverseGeocode(lat, lon) {
  try {
    const j = await getJSON(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&accept-language=pt-BR`
    )
    return j.display_name || null
  } catch (e) {
    return null
  }
}

export async function fetchWeather(lat, lon) {
  const u =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m,visibility,is_day` +
    `&hourly=visibility,precipitation,wind_gusts_10m` +
    `&daily=sunrise,sunset&forecast_days=1&timezone=America%2FBahia`
  const j = await getJSON(u)
  const cur = j.current || {}
  let vis = cur.visibility
  if (vis == null && j.hourly && Array.isArray(j.hourly.visibility)) {
    const now = new Date()
    const idx = Math.min(now.getHours(), j.hourly.visibility.length - 1)
    vis = j.hourly.visibility[idx]
  }
  return {
    temp: cur.temperature_2m,
    precip: cur.precipitation,
    code: cur.weather_code,
    cloud: cur.cloud_cover,
    windKmh: cur.wind_speed_10m,
    windDir: cur.wind_direction_10m,
    gustKmh: cur.wind_gusts_10m,
    visM: vis,
    isDay: cur.is_day,
    sunrise: j.daily?.sunrise?.[0] || null,
    sunset: j.daily?.sunset?.[0] || null,
  }
}

export async function fetchMetar(ids = 'SBSV') {
  try {
    const j = await getJSON(`https://aviationweather.gov/api/data/metar?ids=${ids}&format=json&hours=3`, 15000)
    if (Array.isArray(j) && j.length) return j[0].rawOb || j[0].raw_text || null
    return null
  } catch (e) {
    return null
  }
}

export async function osrmRoute(a, b) {
  const u = `https://router.project-osrm.org/route/v1/driving/${a.lon},${a.lat};${b.lon},${b.lat}?overview=full&geometries=geojson&alternatives=false`
  const j = await getJSON(u, 25000)
  if (!j.routes || !j.routes[0]) throw new Error('sem rota')
  const r = j.routes[0]
  return {
    durMin: r.duration / 60,
    distKm: r.distance / 1000,
    geo: r.geometry.coordinates.map((c) => [c[1], c[0]]), // [lat,lon]
  }
}

const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
]

export async function overpass(query) {
  let err
  for (const ep of OVERPASS) {
    try {
      const r = await fetch(ep, {
        method: 'POST',
        body: 'data=' + encodeURIComponent(query),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        signal: signal(30000),
      })
      if (!r.ok) throw new Error('HTTP ' + r.status)
      const j = await r.json()
      return j.elements || []
    } catch (e) {
      err = e
    }
  }
  throw err || new Error('Overpass indisponível')
}

export function lzQuery(lat, lon, r) {
  return `[out:json][timeout:25];(
nwr(around:${r},${lat},${lon})[aeroway~"^(helipad|heliport)$"];
way(around:${r},${lat},${lon})[leisure~"^(pitch|stadium|sports_centre|track)$"];
way(around:${r},${lat},${lon})[leisure~"^(park|recreation_ground|golf_course)$"];
way(around:${r},${lat},${lon})[landuse~"^(grass|meadow|recreation_ground|village_green)$"];
way(around:${r},${lat},${lon})[natural="beach"];
way(around:${r},${lat},${lon})[amenity="parking"][parking!~"underground|multi-storey|rooftop"];
);out body geom;`
}

export function obstacleQuery(lat, lon, r) {
  return `[out:json][timeout:25];(
way(around:${r},${lat},${lon})[power~"^(line|minor_line)$"];
node(around:${r},${lat},${lon})[power~"^(tower)$"];
nwr(around:${r},${lat},${lon})[man_made~"^(mast|tower|chimney|communications_tower)$"];
);out body geom;`
}
