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
    traffic: false,
  }
}

// polyline codificada (Google, precisão 5) -> [[lat,lon], ...]
function decodePolyline(str) {
  const pts = []
  let lat = 0, lon = 0, i = 0
  while (i < str.length) {
    for (const which of [0, 1]) {
      let shift = 0, result = 0, byte
      do {
        byte = str.charCodeAt(i++) - 63
        result |= (byte & 0x1f) << shift
        shift += 5
      } while (byte >= 0x20)
      const delta = result & 1 ? ~(result >> 1) : result >> 1
      if (which === 0) lat += delta
      else lon += delta
    }
    pts.push([lat / 1e5, lon / 1e5])
  }
  return pts
}

// Google Routes API (computeRoutes) — rota com TRÂNSITO EM TEMPO REAL.
// Chamável do navegador com chave restrita por referrer (CORS habilitado).
export async function googleRoute(a, b, key) {
  const r = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline',
    },
    body: JSON.stringify({
      origin: { location: { latLng: { latitude: a.lat, longitude: a.lon } } },
      destination: { location: { latLng: { latitude: b.lat, longitude: b.lon } } },
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_AWARE',
    }),
    signal: signal(15000),
  })
  if (!r.ok) {
    const err = new Error('Routes API HTTP ' + r.status)
    err.status = r.status
    throw err
  }
  const j = await r.json()
  const rt = j.routes?.[0]
  if (!rt?.duration) throw new Error('sem rota (Routes API)')
  return {
    durMin: parseFloat(rt.duration) / 60, // duração vem como "1234s"
    distKm: (rt.distanceMeters || 0) / 1000,
    geo: rt.polyline?.encodedPolyline ? decodePolyline(rt.polyline.encodedPolyline) : null,
    traffic: true,
  }
}

// 4xx = chave sem a Routes API / bloqueada — não insistir nesta sessão.
// Erros transitórios (rede/5xx) continuam tentando o Google na próxima rota.
let googleRouteBlocked = false

export async function groundRoute(a, b, googleKey) {
  if (googleKey && !googleRouteBlocked) {
    try {
      return await googleRoute(a, b, googleKey)
    } catch (e) {
      if (e.status >= 400 && e.status < 500) googleRouteBlocked = true
      console.warn('[skyrescue] Routes API indisponível, usando OSRM:', e.message || e)
    }
  }
  return osrmRoute(a, b)
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

// Helipontos valem a pena mesmo mais longe que as LZs improvisadas
// (o deslocamento extra de voo é irrelevante; o transbordo não).
export function heliRadius(r) {
  return Math.max(r, 4000)
}

export function lzQuery(lat, lon, r) {
  // praias: nwr — muitas estão no OSM como nó ou relação (multipolígono),
  // e a cláusula "way" sozinha as deixava de fora
  return `[out:json][timeout:25];(
nwr(around:${heliRadius(r)},${lat},${lon})[aeroway~"^(helipad|heliport)$"];
way(around:${r},${lat},${lon})[leisure~"^(pitch|stadium|sports_centre|track)$"];
way(around:${r},${lat},${lon})[leisure~"^(park|recreation_ground|golf_course)$"];
way(around:${r},${lat},${lon})[landuse~"^(grass|meadow|recreation_ground|village_green)$"];
nwr(around:${r},${lat},${lon})[natural~"^(beach|sand)$"];
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
