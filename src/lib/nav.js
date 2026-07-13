// Utilidades de navegação do modo piloto.
// Convenções GPS: rumo (track/course) em graus VERDADEIROS (0–360, N=0),
// velocidade em km/h sobre o solo (groundspeed).

const rad = (d) => (d * Math.PI) / 180
const deg = (r) => (r * 180) / Math.PI

// rumo inicial do círculo máximo de a até b (graus verdadeiros)
export function bearingDeg(a, b) {
  const φ1 = rad(a.lat), φ2 = rad(b.lat), Δλ = rad(b.lon - a.lon)
  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  return (deg(Math.atan2(y, x)) + 360) % 360
}

// desloca um ponto por dist (km) num rumo (graus) — usado pelo simulador
export function destPoint(a, brgDeg, distKm) {
  const R = 6371
  const δ = distKm / R, θ = rad(brgDeg)
  const φ1 = rad(a.lat), λ1 = rad(a.lon)
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ))
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2))
  return { lat: deg(φ2), lon: ((deg(λ2) + 540) % 360) - 180 }
}

export const kmhToKt = (kmh) => kmh * 0.539957
export const kmToNm = (km) => km * 0.539957

export const fmtDeg = (d) => (d == null ? '—' : String(Math.round(d)).padStart(3, '0') + '°')

export function fmtDistKm(km) {
  if (km == null) return '—'
  return km < 10 ? km.toFixed(1) : String(Math.round(km))
}

// minutos de voo restantes → "mm min" / "h:mm"
export function fmtEte(min) {
  if (min == null || !isFinite(min)) return '—'
  if (min < 60) return `${Math.max(1, Math.round(min))} min`
  const h = Math.floor(min / 60)
  return `${h}:${String(Math.round(min % 60)).padStart(2, '0')} h`
}

export const fmtClock = (ts) =>
  new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
