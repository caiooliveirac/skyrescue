// Utilidades geográficas puras (testáveis com Node)

const rad = (d) => (d * Math.PI) / 180

export function haversineKm(a, b) {
  const R = 6371
  const dLat = rad(b.lat - a.lat)
  const dLon = rad(b.lon - a.lon)
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)))
}

export function fmtKm(km) {
  if (km == null) return '—'
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`
}

export function fmtMin(m) {
  if (m == null || isNaN(m)) return '—'
  const r = Math.round(m)
  if (r < 60) return `${r} min`
  const h = Math.floor(r / 60)
  return `${h} h ${String(r % 60).padStart(2, '0')} min`
}

export function fmtClock(d) {
  if (!d) return '—'
  const dt = typeof d === 'number' ? new Date(d) : d
  return dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

export function toDMS(v, isLat) {
  const dir = isLat ? (v >= 0 ? 'N' : 'S') : (v >= 0 ? 'E' : 'W')
  const abs = Math.abs(v)
  const deg = Math.floor(abs)
  const minF = (abs - deg) * 60
  const min = Math.floor(minF)
  const sec = (minF - min) * 60
  return `${deg}°${String(min).padStart(2, '0')}'${sec.toFixed(1)}"${dir}`
}

// Graus e minutos decimais (DDM) — formato padrão da aviação, usado em
// cartas, GPS e FMS. Latitude com 2 dígitos de grau, longitude com 3.
// Ex.: "12°58.31'S 038°30.07'W"
export function toDDM(v, isLat) {
  const dir = isLat ? (v >= 0 ? 'N' : 'S') : (v >= 0 ? 'E' : 'W')
  const abs = Math.abs(v)
  const deg = Math.floor(abs)
  const min = (abs - deg) * 60
  const dd = String(deg).padStart(isLat ? 2 : 3, '0')
  const mm = min.toFixed(2).padStart(5, '0')
  return `${dd}°${mm}'${dir}`
}

export function fmtCoords(p) {
  if (!p) return '—'
  return `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`
}

export function fmtCoordsDMS(p) {
  if (!p) return '—'
  return `${toDMS(p.lat, true)} ${toDMS(p.lon, false)}`
}

// Coordenadas no formato aeronáutico (DDM) — o que os pilotos leem/inserem.
export function fmtCoordsDDM(p) {
  if (!p) return '—'
  return `${toDDM(p.lat, true)} ${toDDM(p.lon, false)}`
}

export function gmapsLink(p) {
  return `https://maps.google.com/?q=${p.lat.toFixed(6)},${p.lon.toFixed(6)}`
}

// dimensões aproximadas (m) de um bounding box do Overpass
export function bboxDimsM(b) {
  if (!b) return null
  const h = haversineKm({ lat: b.minlat, lon: b.minlon }, { lat: b.maxlat, lon: b.minlon }) * 1000
  const w = haversineKm({ lat: b.minlat, lon: b.minlon }, { lat: b.minlat, lon: b.maxlon }) * 1000
  return { w: Math.round(w), h: Math.round(h) }
}

// menor largura (m) de um polígono [{lat,lon},...] — hull convexo + rotating
// calipers. Mais fiel que o bounding box p/ áreas alongadas ou diagonais.
export function polyMinWidthM(pts) {
  if (!pts || pts.length < 3) return null
  const lat0 = pts[0].lat
  const kx = 111320 * Math.cos(rad(lat0))
  const ky = 110540
  const P = pts.map((p) => [(p.lon - pts[0].lon) * kx, (p.lat - pts[0].lat) * ky])
  P.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower = []
  for (const p of P) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper = []
  for (let i = P.length - 1; i >= 0; i--) {
    const p = P[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop()
    upper.push(p)
  }
  const hull = lower.slice(0, -1).concat(upper.slice(0, -1))
  if (hull.length < 3) return 0
  let min = Infinity
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length]
    const dx = b[0] - a[0], dy = b[1] - a[1]
    const len = Math.hypot(dx, dy)
    if (len === 0) continue
    let maxD = 0
    for (const p of hull) {
      const d = Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / len
      if (d > maxD) maxD = d
    }
    if (maxD < min) min = maxD
  }
  return Number.isFinite(min) ? Math.round(min) : null
}

// menor distância (m) de um ponto a uma polilinha [{lat,lon},...]
export function minDistToLineM(p, coords) {
  if (!coords || !coords.length) return Infinity
  const kx = 111320 * Math.cos(rad(p.lat))
  const ky = 110540
  const toXY = (c) => [(c.lon - p.lon) * kx, (c.lat - p.lat) * ky]
  let min = Infinity
  let prev = null
  for (const c of coords) {
    const cur = toXY(c)
    min = Math.min(min, Math.hypot(cur[0], cur[1]))
    if (prev) min = Math.min(min, distToSegment([0, 0], prev, cur))
    prev = cur
  }
  return min
}

function distToSegment(p, a, b) {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const l2 = dx * dx + dy * dy
  if (l2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1])
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
}
