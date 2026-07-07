import { haversineKm } from './geo.js'

// ---------------- Modelo de tempos ----------------
// AÉREO  = acionamento + [pickup equipe] + voo(base→cena) + embarque
//          + voo(cena→ponto de pouso) + desembarque (heliponto próprio)
//          OU transbordo (heliponto de apoio / LZ → ambulância → hospital)
// TERRESTRE = ETA ambulância→cena + atendimento na cena + rota(cena→hospital)×fator trânsito
export function computeMission({ cfg, scene, hospital, lzPoint, landingHelipad, groundRoute, ambulanceEtaMin }) {
  if (!scene) return null
  const { base, aircraft: ac, times: t, ground, ops } = cfg
  const p1 = lzPoint || scene
  const legs = []

  // ponto onde a aeronave pousa no destino:
  // heliponto do próprio hospital > heliponto de apoio > o próprio hospital (LZ genérica + transbordo)
  const landing = hospital ? (hospital.heliponto ? hospital : landingHelipad || hospital) : null

  let dOut = 0
  let flightOutMin = 0
  let pickup = null
  if (ops.pickupEnabled && ops.pickupHospitalId) {
    pickup = cfg.hospitals.find((h) => h.id === ops.pickupHospitalId && h.heliponto) || null
  }
  if (pickup) {
    const d1 = haversineKm(base, pickup) * ac.routeFactor
    const d2 = haversineKm(pickup, p1) * ac.routeFactor
    dOut = d1 + d2
    flightOutMin = (dOut / ac.cruiseKmh) * 60 + t.pickupStopMin
    legs.push({ k: 'voo_pickup', label: `Voo base → ${pickup.name} (equipe SAMU)`, min: (d1 / ac.cruiseKmh) * 60, km: d1 })
    legs.push({ k: 'pickup', label: 'Embarque da equipe SAMU', min: t.pickupStopMin })
    legs.push({ k: 'voo_ida', label: 'Voo → cena', min: (d2 / ac.cruiseKmh) * 60, km: d2 })
  } else {
    dOut = haversineKm(base, p1) * ac.routeFactor
    flightOutMin = (dOut / ac.cruiseKmh) * 60
    legs.push({ k: 'voo_ida', label: 'Voo base → cena', min: flightOutMin, km: dOut })
  }

  const dSH = landing ? haversineKm(p1, landing) * ac.routeFactor : null
  const flightBackMin = dSH != null ? (dSH / ac.cruiseKmh) * 60 : null
  const finalMin = hospital ? (hospital.heliponto ? t.desembarqueMin : t.transbordoMin) : null

  const airTotal =
    hospital != null && flightBackMin != null
      ? t.acionamentoMin + flightOutMin + t.embarqueMin + flightBackMin + finalMin
      : null

  const allLegs = [
    { k: 'acionamento', label: 'Acionamento → decolagem', min: t.acionamentoMin },
    ...legs,
    { k: 'embarque', label: 'Pouso na cena + embarque do paciente', min: t.embarqueMin },
  ]
  if (hospital) {
    const dest = hospital.heliponto ? hospital.name : landingHelipad ? landingHelipad.name : hospital.name
    allLegs.push({ k: 'voo_volta', label: `Voo cena → ${dest}`, min: flightBackMin, km: dSH })
    allLegs.push({
      k: 'final',
      label: hospital.heliponto
        ? 'Desembarque no heliponto do hospital'
        : landingHelipad
          ? `Transbordo ${landingHelipad.name} → ${hospital.name}`
          : 'Pouso em LZ + transbordo terrestre até o hospital',
      min: finalMin,
    })
  }

  // terrestre — rota traffic-aware (Google) já embute o trânsito;
  // o fator manual só se aplica ao OSRM (sem trânsito em tempo real)
  const gFactor = groundRoute?.traffic ? 1 : ground.trafficFactor
  const gToHospMin = groundRoute ? groundRoute.durMin * gFactor : null
  const eta = ambulanceEtaMin != null && ambulanceEtaMin !== '' ? Number(ambulanceEtaMin) : null
  const gTotal = eta != null && gToHospMin != null ? eta + t.cenaMin + gToHospMin : null
  const gPartial = gToHospMin != null ? t.cenaMin + gToHospMin : null // sem ETA da ambulância

  const delta = airTotal != null && gTotal != null ? gTotal - airTotal : null
  // sem ponto de pouso resolvido, assume retorno da cena (piso realista p/ autonomia)
  const dReturn = landing ? haversineKm(landing, base) * ac.routeFactor : dOut
  const missionKm = dOut + (dSH || 0) + dReturn
  const returnMin = (dReturn / ac.cruiseKmh) * 60
  const missionEndMin = airTotal != null ? airTotal + returnMin : null // aeronave de volta à base

  return {
    legs: allLegs,
    airTotal,
    returnMin,
    missionEndMin,
    flightOutMin,
    pickup,
    landing: landing ? { lat: landing.lat, lon: landing.lon, name: landing.name, isHelipad: !!(hospital?.heliponto || landingHelipad) } : null,
    landingHelipad: landingHelipad || null,
    ground: { etaMin: eta, cenaMin: t.cenaMin, toHospMin: gToHospMin, total: gTotal, partial: gPartial, distKm: groundRoute?.distKm ?? null, traffic: !!groundRoute?.traffic },
    delta,
    missionKm,
    dOut,
    dSH,
  }
}

// checks automáticos do checklist a partir da missão calculada
export function autoChecks(mission) {
  if (!mission) return { t_60: null, t_reduz: null }
  const g = mission.ground
  const gKnown = g.total != null ? g.total : g.partial
  const t60 = gKnown != null ? gKnown > 60 : null
  let reduz = null
  if (mission.airTotal != null && g.total != null) {
    reduz = g.total - mission.airTotal >= 20 || mission.airTotal <= 0.7 * g.total
  }
  return { t_60: t60, t_reduz: reduz }
}

// ---------------- Meteorologia ----------------
const TS_CODES = [95, 96, 99]
const HEAVY_CODES = [65, 67, 82, 86]
const FOG_CODES = [45, 48]

export const WMO_LABEL = {
  0: 'Céu limpo', 1: 'Predomínio de sol', 2: 'Parcialmente nublado', 3: 'Nublado',
  45: 'Nevoeiro', 48: 'Nevoeiro c/ gelo', 51: 'Garoa leve', 53: 'Garoa', 55: 'Garoa intensa',
  61: 'Chuva leve', 63: 'Chuva moderada', 65: 'Chuva forte', 80: 'Pancadas leves',
  81: 'Pancadas moderadas', 82: 'Pancadas fortes', 95: 'Trovoada', 96: 'Trovoada c/ granizo', 99: 'Trovoada severa',
}

export function classifyWeather(w) {
  if (!w) return { level: 'unknown', reasons: ['Sem dados meteorológicos'] }
  const reasons = []
  let level = 'ok'
  const bump = (l) => { if (l === 'fail' || (l === 'warn' && level === 'ok')) level = l }

  if (TS_CODES.includes(w.code)) { reasons.push('Trovoada na área'); bump('fail') }
  if (w.visM != null && w.visM < 3000) { reasons.push(`Visibilidade ${(w.visM / 1000).toFixed(1)} km (<3 km)`); bump('fail') }
  else if (w.visM != null && w.visM < 5000) { reasons.push(`Visibilidade reduzida ${(w.visM / 1000).toFixed(1)} km`); bump('warn') }
  if (w.gustKmh != null && w.gustKmh > 65) { reasons.push(`Rajadas ${Math.round(w.gustKmh)} km/h (>35 kt)`); bump('fail') }
  else if (w.gustKmh != null && w.gustKmh >= 46) { reasons.push(`Rajadas ${Math.round(w.gustKmh)} km/h`); bump('warn') }
  if (w.precip != null && w.precip > 7) { reasons.push(`Chuva forte ${w.precip} mm/h`); bump('fail') }
  else if (w.precip != null && w.precip >= 2) { reasons.push(`Chuva ${w.precip} mm/h`); bump('warn') }
  if (HEAVY_CODES.includes(w.code)) { reasons.push(WMO_LABEL[w.code] || 'Precipitação forte'); bump('warn') }
  if (FOG_CODES.includes(w.code)) { reasons.push('Nevoeiro'); bump(w.visM != null && w.visM < 3000 ? 'fail' : 'warn') }
  if (w.cloud != null && w.cloud >= 90) { reasons.push(`Cobertura de nuvens ${w.cloud}%`); bump('warn') }

  if (!reasons.length) reasons.push('Sem restrições relevantes detectadas')
  return { level, reasons }
}

// pior condição entre cena e base
export function combinedWeatherStatus(wScene, wBase) {
  const order = { fail: 3, warn: 2, unknown: 1, ok: 0 }
  const a = classifyWeather(wScene)
  const b = classifyWeather(wBase)
  return order[a.level] >= order[b.level] ? a.level : b.level
}

// ---------------- Janela diurna (VFR) ----------------
export function daylightCheck({ sunsetISO, airTotalMin, nightAllowed, marginMin }) {
  if (nightAllowed) return { status: 'ok', note: 'Operação noturna habilitada — verificar critérios específicos (LZ iluminada).' }
  if (!sunsetISO || airTotalMin == null) return { status: 'unknown', note: 'Sem dados de pôr do sol ou tempos.' }
  const sunset = new Date(sunsetISO)
  const end = new Date(Date.now() + airTotalMin * 60000)
  const slackMin = (sunset - end) / 60000
  if (slackMin < marginMin) {
    return { status: 'fail', sunset, end, slackMin, note: `Aeronave pousaria de volta na base ~${fmtHM(end)}, pôr do sol ${fmtHM(sunset)} (margem < ${marginMin} min).` }
  }
  if (slackMin < marginMin + 40) {
    return { status: 'warn', sunset, end, slackMin, note: `Janela apertada: retorno à base ~${fmtHM(end)}, pôr do sol ${fmtHM(sunset)}.` }
  }
  return { status: 'ok', sunset, end, slackMin, note: `Pôr do sol ${fmtHM(sunset)} — janela suficiente.` }
}

function fmtHM(d) {
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

export function rangeCheck(missionKm, aircraft) {
  if (missionKm == null) return { status: 'unknown' }
  const limit = aircraft.rangeKm * 0.8
  return {
    status: missionKm <= limit ? 'ok' : 'fail',
    missionKm,
    limit,
    note: `Percurso total ~${Math.round(missionKm)} km (limite prudencial ${Math.round(limit)} km).`,
  }
}
