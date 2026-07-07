import { haversineKm, bboxDimsM, minDistToLineM, polyMinWidthM } from './geo.js'

// Área recomendada p/ AS350 (rotor ~10,7 m): LZ ≥ ~30×30 m dia; campo de futebol é ideal.
const TYPE_INFO = [
  { match: (t) => t.aeroway === 'helipad' || t.aeroway === 'heliport', type: 'Heliponto', prio: 0, emoji: '🅗', typeKey: 'heli' },
  { match: (t) => t.leisure === 'stadium', type: 'Estádio', prio: 1, emoji: '🏟', typeKey: 'campo' },
  { match: (t) => t.leisure === 'pitch', type: 'Campo/quadra', prio: 1, emoji: '⚽', typeKey: 'campo' },
  { match: (t) => t.leisure === 'sports_centre' || t.leisure === 'track', type: 'Área esportiva', prio: 1, emoji: '🏃', typeKey: 'campo' },
  { match: (t) => t.natural === 'beach', type: 'Praia', prio: 2, emoji: '🏖', typeKey: 'praia' },
  { match: (t) => t.leisure === 'park' || t.leisure === 'recreation_ground' || t.leisure === 'golf_course', type: 'Parque/área verde', prio: 2, emoji: '🌳', typeKey: 'verde' },
  { match: (t) => !!t.landuse, type: 'Área gramada', prio: 2, emoji: '🌿', typeKey: 'verde' },
  { match: (t) => t.amenity === 'parking', type: 'Estacionamento', prio: 3, emoji: '🅿', typeKey: 'estac' },
]

export const LZ_FILTERS = [
  { key: 'all', label: 'Todas' },
  { key: 'heli', label: 'Helipontos' },
  { key: 'campo', label: 'Campos e estádios' },
  { key: 'verde', label: 'Gramados' },
  { key: 'praia', label: 'Praias' },
  { key: 'estac', label: 'Estacionamentos' },
]

export function parseObstacles(elements) {
  const lines = [] // polilinhas de rede elétrica
  const points = [] // torres/mastros
  for (const el of elements || []) {
    if (el.type === 'way' && el.geometry) {
      lines.push({ id: el.id, tags: el.tags || {}, coords: el.geometry.map((g) => ({ lat: g.lat, lon: g.lon })) })
    } else if (el.lat != null) {
      points.push({ id: el.id, tags: el.tags || {}, lat: el.lat, lon: el.lon })
    }
  }
  return { lines, points }
}

export function rankLZ(elements, scene, obstacles, opts = {}) {
  const seen = new Set()
  const out = []
  for (const el of elements || []) {
    const tags = el.tags || {}
    const info = TYPE_INFO.find((ti) => ti.match(tags))
    if (!info) continue
    // Overpass não aceita "center" e "bb" juntos no out — quando só o
    // bounds vem na resposta, o centro é derivado dele aqui.
    const b = el.bounds
    const lat = el.lat ?? el.center?.lat ?? (b ? (b.minlat + b.maxlat) / 2 : null)
    const lon = el.lon ?? el.center?.lon ?? (b ? (b.minlon + b.maxlon) / 2 : null)
    if (lat == null || lon == null) continue
    const key = `${lat.toFixed(5)}|${lon.toFixed(5)}`
    if (seen.has(key)) continue
    seen.add(key)

    const dims = bboxDimsM(el.bounds)
    // largura mínima real do polígono quando o OSM traz a geometria;
    // bounding box superestima áreas alongadas/diagonais
    const geomW = el.geometry ? polyMinWidthM(el.geometry) : null
    const minDim = geomW ?? (dims ? Math.min(dims.w, dims.h) : null)
    const distM = Math.round(haversineKm(scene, { lat, lon }) * 1000)

    // proximidade de obstáculos (rede elétrica / torres)
    let obstM = Infinity
    let obstWhat = null
    if (obstacles) {
      for (const ln of obstacles.lines) {
        const d = minDistToLineM({ lat, lon }, ln.coords)
        if (d < obstM) { obstM = d; obstWhat = 'rede elétrica' }
      }
      for (const p of obstacles.points) {
        const d = haversineKm({ lat, lon }, p) * 1000
        if (d < obstM) { obstM = d; obstWhat = p.tags.man_made ? 'torre/mastro' : 'torre de energia' }
      }
    }
    const obstFlag = obstM < 150
    const obstNear = isFinite(obstM) ? Math.round(obstM) : null

    let suit, suitKey
    if (info.type === 'Heliponto') { suit = 'Ideal (heliponto)'; suitKey = 'ideal' }
    else if (minDim != null && minDim >= 45) { suit = 'Boa (ampla)'; suitKey = 'boa' }
    else if (minDim != null && minDim >= 28) { suit = 'Avaliar dimensões'; suitKey = 'avaliar' }
    else if (minDim != null) { suit = 'Restrita (<28 m)'; suitKey = 'restrita' }
    else { suit = 'Dimensões desconhecidas'; suitKey = 'avaliar' }

    const name = tags.name || `${info.type} sem nome`
    const sortKey = info.prio * 1.2 + distM / 800 + (obstFlag ? 1.5 : 0) + (suitKey === 'restrita' ? 2 : 0)
    out.push({
      id: `${el.type}/${el.id}`, name, type: info.type, typeKey: info.typeKey, emoji: info.emoji, lat, lon,
      dims, minDim, distM, obstFlag, obstNear, obstWhat, suit, suitKey, sortKey,
      bounds: el.bounds || null,
      lit: tags.lit === 'yes', surface: tags.surface || null,
    })
  }
  out.sort((a, b) => a.sortKey - b.sortKey)
  const top = out.slice(0, opts.max || 10)
  const letters = 'ABCDEFGHIJ'
  top.forEach((c, i) => (c.letter = letters[i]))
  return top
}

export function walkMin(distM) {
  return Math.max(1, Math.round((distM / 1000) * (60 / 4.5))) // ~4,5 km/h
}
