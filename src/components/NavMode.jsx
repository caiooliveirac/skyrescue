import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
// adiciona rotação ao Leaflet (map.setBearing) — usada no modo "rumo em cima";
// marcadores continuam "de pé" na tela (o plugin os contra-rotaciona)
import 'leaflet-rotate'
import { haversineKm } from '../lib/geo.js'
import { bearingDeg, destPoint, kmhToKt, kmToNm, fmtDeg, fmtDistKm, fmtEte, fmtClock } from '../lib/nav.js'
import { api } from '../lib/backend.js'
import { IconX, IconTarget, IconAlert } from './Icons.jsx'
import { MilestoneQuick } from './Tracking.jsx'

const CARTO_DARK = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
const ESRI_IMAGERY = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'

// seta de posição própria (estilo GPS): aponta para o rumo atual
const ownshipSvg =
  '<svg viewBox="0 0 24 24" width="30" height="30"><path d="M12 2 L19.5 21 L12 16.6 L4.5 21 Z" fill="#22d3ee" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>'

const wptHtml = (cls, label) => `<div class="nav-wpt ${cls}">${label}</div>`

export default function NavMode({ cfg, scene, lzPoint, hospital, landingHelipad, events, onQuickMark, onUndoMark, onClose }) {
  const divRef = useRef(null)
  const mapRef = useRef(null)
  const tileRef = useRef(null)
  const wptLayerRef = useRef(null)  // waypoints + pernas planejadas (estático)
  const dynLayerRef = useRef(null)  // posição própria, rastro, linha-guia
  const ownRef = useRef(null)
  const accRef = useRef(null)
  const crumbRef = useRef(null)
  const guideRef = useRef(null)
  const lastFixRef = useRef(null)
  const followRef = useRef(true)

  const [fix, setFix] = useState(null)        // {lat, lon, accM, gsKmh, track, ts}
  const [gpsErr, setGpsErr] = useState(null)
  const [orient, setOrient] = useState('north') // 'north' | 'track'
  const orientRef = useRef('north')
  const [follow, setFollow] = useState(true)
  const [layer, setLayer] = useState('dark')   // 'dark' | 'sat'
  const [sim, setSim] = useState(false)
  const simRef = useRef(null)
  const lastTxRef = useRef(0)
  const [txTs, setTxTs] = useState(0) // último envio de posição aceito pelo servidor

  // pouso no destino: heliponto do hospital, apoio associado, ou o próprio hospital (LZ)
  const landPt = hospital ? (hospital.heliponto ? hospital : landingHelipad || hospital) : null

  // alvos navegáveis da missão, na ordem operacional
  const targets = useMemo(() => {
    const t = []
    if (lzPoint) t.push({ id: 'lz', label: lzPoint.name || 'LZ manual', short: 'LZ', cls: 'lz', lat: lzPoint.lat, lon: lzPoint.lon })
    else if (scene) t.push({ id: 'cena', label: 'Ocorrência', short: 'CENA', cls: 'cena', lat: scene.lat, lon: scene.lon })
    if (landPt) t.push({ id: 'dest', label: landPt.name, short: 'DEST', cls: 'dest', lat: landPt.lat, lon: landPt.lon })
    t.push({ id: 'base', label: cfg.base.name, short: 'BASE', cls: 'base', lat: cfg.base.lat, lon: cfg.base.lon })
    return t
    // eslint-disable-next-line
  }, [scene, lzPoint, hospital, landingHelipad, cfg.base.lat, cfg.base.lon])

  const [targetId, setTargetId] = useState(targets[0].id)
  const target = targets.find((t) => t.id === targetId) || targets[0]
  const targetRef = useRef(target)
  targetRef.current = target
  followRef.current = follow
  orientRef.current = orient

  // ---------- mapa ----------
  useEffect(() => {
    const start = scene || cfg.base
    const m = L.map(divRef.current, {
      rotate: true, rotateControl: false, touchRotate: false,
      zoomControl: false, attributionControl: false,
    }).setView([start.lat, start.lon], 12)
    wptLayerRef.current = L.layerGroup().addTo(m)
    dynLayerRef.current = L.layerGroup().addTo(m)
    m.on('dragstart', () => setFollow(false))
    mapRef.current = m
    return () => { m.remove(); mapRef.current = null }
    // eslint-disable-next-line
  }, [])

  // camada base (sem Google no modo nav: rotação testada só com tiles padrão)
  useEffect(() => {
    const m = mapRef.current
    if (!m) return
    if (tileRef.current) m.removeLayer(tileRef.current)
    tileRef.current = (layer === 'sat'
      ? L.tileLayer(ESRI_IMAGERY, { maxZoom: 19 })
      : L.tileLayer(CARTO_DARK, { maxZoom: 20, subdomains: 'abcd' })
    ).addTo(m)
  }, [layer])

  // waypoints + pernas planejadas
  useEffect(() => {
    const lay = wptLayerRef.current
    if (!lay) return
    lay.clearLayers()
    const path = []
    for (const t of targets) {
      L.marker([t.lat, t.lon], {
        icon: L.divIcon({ className: 'mk', html: wptHtml(t.cls, t.short), iconSize: [44, 20], iconAnchor: [22, 10] }),
        zIndexOffset: 100,
      }).bindTooltip(t.label).addTo(lay)
    }
    // rota planejada: base -> cena/LZ -> destino
    const legPts = [[cfg.base.lat, cfg.base.lon]]
    const first = targets.find((t) => t.id === 'lz' || t.id === 'cena')
    if (first) legPts.push([first.lat, first.lon])
    if (landPt) legPts.push([landPt.lat, landPt.lon])
    if (legPts.length > 1) L.polyline(legPts, { color: '#22d3ee', weight: 2, opacity: 0.5, dashArray: '7 7' }).addTo(lay)
    if (scene && lzPoint) {
      L.circleMarker([scene.lat, scene.lon], { radius: 6, color: '#fb7185', fillOpacity: 0.9 }).bindTooltip('Ocorrência').addTo(lay)
    }
    // eslint-disable-next-line
  }, [targets])

  // ---------- posição: GPS real ou simulador ----------
  useEffect(() => {
    lastFixRef.current = null
    if (sim) {
      // simulador (dev): decola da base rumo ao alvo na velocidade de cruzeiro
      let pos = { lat: cfg.base.lat, lon: cfg.base.lon }
      setGpsErr(null)
      simRef.current = setInterval(() => {
        const tgt = targetRef.current
        const distKm = haversineKm(pos, tgt)
        const gs = distKm < 0.15 ? 0 : cfg.aircraft.cruiseKmh
        const trk = bearingDeg(pos, tgt)
        if (gs > 0) pos = destPoint(pos, trk, gs / 3600) // passo de 1 s
        setFix({ lat: pos.lat, lon: pos.lon, accM: 5, gsKmh: gs, track: gs > 0 ? trk : null, ts: Date.now() })
      }, 1000)
      return () => clearInterval(simRef.current)
    }
    if (!navigator.geolocation) { setGpsErr('GPS indisponível neste dispositivo/navegador'); return }
    const id = navigator.geolocation.watchPosition(
      (p) => {
        const { latitude: lat, longitude: lon, accuracy, speed, heading } = p.coords
        const prev = lastFixRef.current
        let gsKmh = speed != null && isFinite(speed) ? speed * 3.6 : null
        let track = heading != null && isFinite(heading) ? heading : null
        // fallback: deriva rumo/velocidade do fix anterior (alguns devices não enviam)
        if (prev) {
          const dtH = (p.timestamp - prev.ts) / 3600_000
          const dKm = haversineKm(prev, { lat, lon })
          if (gsKmh == null && dtH > 0) gsKmh = dKm / dtH
          if (track == null && dKm > 0.008) track = bearingDeg(prev, { lat, lon })
        }
        const f = { lat, lon, accM: Math.round(accuracy || 0), gsKmh, track, ts: p.timestamp || Date.now() }
        lastFixRef.current = f
        setGpsErr(null)
        setFix(f)
      },
      (e) => setGpsErr(e.code === 1 ? 'Permissão de localização negada — habilite o GPS para este site' : 'Sem sinal de GPS'),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 }
    )
    return () => navigator.geolocation.clearWatch(id)
    // eslint-disable-next-line
  }, [sim])

  // ---------- aplica o fix no mapa ----------
  useEffect(() => {
    const m = mapRef.current
    const lay = dynLayerRef.current
    if (!m || !lay || !fix) return
    const ll = [fix.lat, fix.lon]

    // orientação do mapa: rumo em cima gira o mapa; norte em cima zera
    const bearing = orientRef.current === 'track' && fix.track != null ? -fix.track : 0
    if (m.setBearing) m.setBearing(bearing)
    // seta aponta o rumo na tela (marcadores ficam "de pé": soma o giro do mapa)
    const rot = fix.track != null ? fix.track + bearing : 0

    if (!ownRef.current) {
      ownRef.current = L.marker(ll, {
        icon: L.divIcon({ className: 'mk', html: `<div class="nav-own" style="transform:rotate(${rot}deg)">${ownshipSvg}</div>`, iconSize: [30, 30], iconAnchor: [15, 15] }),
        zIndexOffset: 1000,
      }).addTo(lay)
      accRef.current = L.circle(ll, { radius: fix.accM || 0, color: '#22d3ee', weight: 1, opacity: 0.35, fillOpacity: 0.06 }).addTo(lay)
      crumbRef.current = L.polyline([ll], { color: '#22d3ee', weight: 2, opacity: 0.55 }).addTo(lay)
      guideRef.current = L.polyline([ll, [targetRef.current.lat, targetRef.current.lon]], { color: '#c084fc', weight: 2.5, opacity: 0.9, dashArray: '2 8' }).addTo(lay)
      m.setView(ll, 13)
    } else {
      ownRef.current.setLatLng(ll)
      const el = ownRef.current.getElement()?.querySelector('.nav-own')
      if (el) el.style.transform = `rotate(${rot}deg)`
      accRef.current.setLatLng(ll); accRef.current.setRadius(fix.accM || 0)
      const pts = crumbRef.current.getLatLngs()
      pts.push(L.latLng(ll)); if (pts.length > 600) pts.shift()
      crumbRef.current.setLatLngs(pts)
      guideRef.current.setLatLngs([ll, [targetRef.current.lat, targetRef.current.lon]])
      if (followRef.current) m.setView(ll, m.getZoom(), { animate: false })
    }
  }, [fix, orient, targetId]) // eslint-disable-line

  // transmite a posição ao servidor (~5 s) — a regulação vê o heli no mapa
  useEffect(() => {
    if (!fix) return
    const now = Date.now()
    if (now - lastTxRef.current < 5000) return
    lastTxRef.current = now
    api.reportAircraft({ lat: fix.lat, lon: fix.lon, gsKmh: fix.gsKmh, track: fix.track, accM: fix.accM })
      .then(() => setTxTs(Date.now()))
      .catch(() => {}) // sem dados de celular em voo: tenta de novo no próximo fix
  }, [fix])

  // trava o scroll da página atrás do overlay (tablet no colo balança)
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.scrollTo(0, 0)
    return () => { document.body.style.overflow = prev }
  }, [])

  // tela sempre acesa em voo (Wake Lock; melhor esforço)
  useEffect(() => {
    let lock = null
    const grab = async () => { try { lock = await navigator.wakeLock?.request('screen') } catch (e) { /* sem suporte */ } }
    grab()
    const onVis = () => document.visibilityState === 'visible' && grab()
    document.addEventListener('visibilitychange', onVis)
    return () => { document.removeEventListener('visibilitychange', onVis); lock?.release?.().catch(() => {}) }
  }, [])

  // ---------- leituras ----------
  const distKm = fix ? haversineKm(fix, target) : null
  const brg = fix ? bearingDeg(fix, target) : null
  const gs = fix?.gsKmh ?? null
  const eteMin = distKm != null && gs != null && gs > 30 ? (distKm / gs) * 60 : null
  const etaTs = eteMin != null ? Date.now() + eteMin * 60_000 : null
  const stale = fix && Date.now() - fix.ts > 8000

  const recenter = () => {
    setFollow(true)
    if (fix && mapRef.current) mapRef.current.setView([fix.lat, fix.lon], Math.max(mapRef.current.getZoom(), 12))
  }

  return (
    <div className="navmode">
      <div id="navmap" ref={divRef} />

      {/* HUD principal */}
      <div className="navhud">
        <div className="cell">
          <label>GS</label>
          <b>{gs != null ? Math.round(gs) : '—'}</b>
          <span>km/h{gs != null ? ` · ${Math.round(kmhToKt(gs))} kt` : ''}</span>
        </div>
        <div className="cell">
          <label>RUMO</label>
          <b>{fmtDeg(fix?.track)}</b>
          <span>verd.</span>
        </div>
        <div className="cell tgt">
          <label>→ {target.short} · {fmtDeg(brg)}</label>
          <b>{fmtDistKm(distKm)}</b>
          <span>km{distKm != null ? ` · ${fmtDistKm(kmToNm(distKm))} NM` : ''}</span>
        </div>
        <div className="cell">
          <label>ETE</label>
          <b className="ete">{fmtEte(eteMin)}</b>
          <span>{etaTs ? `ETA ${fmtClock(etaTs)}` : gs != null && gs <= 30 ? 'parado' : ''}</span>
        </div>
      </div>
      <div className="navtgtname">{target.label}</div>

      {(gpsErr || !fix || stale) && (
        <div className="navgps">
          <IconAlert size={14} /> {gpsErr || (!fix ? 'aguardando sinal de GPS…' : 'sinal de GPS atrasado')}
        </div>
      )}
      {fix && !gpsErr && fix.accM > 80 && !stale && (
        <div className="navgps warn"><IconAlert size={14} /> precisão baixa: ±{fix.accM} m</div>
      )}

      {/* marcação rápida dos horários da missão: um toque no próximo marco */}
      {events && scene && (
        <MilestoneQuick events={events} onMark={onQuickMark} onUndo={onUndoMark} className="navqmark" />
      )}

      {/* controles */}
      <div className="navctl">
        <div className="grp">
          {targets.map((t) => (
            <button key={t.id} className={t.id === targetId ? 'on' : ''} onClick={() => setTargetId(t.id)}>
              <IconTarget size={12} /> {t.short}
            </button>
          ))}
        </div>
        <div className="grp">
          <button className={orient === 'north' ? 'on' : ''} onClick={() => setOrient('north')} title="Norte verdadeiro em cima">N ↑</button>
          <button className={orient === 'track' ? 'on' : ''} onClick={() => setOrient('track')} title="Direção do voo em cima (o mapa gira)">RUMO ↑</button>
        </div>
        <div className="grp">
          <button className={follow ? 'on' : ''} onClick={recenter} title="Seguir a aeronave">Seguir</button>
          <button onClick={() => setLayer(layer === 'dark' ? 'sat' : 'dark')}>{layer === 'dark' ? 'Satélite' : 'Mapa'}</button>
          {import.meta.env.DEV && (
            <button className={sim ? 'on' : ''} onClick={() => setSim(!sim)} title="Simular voo (apenas dev)">SIM</button>
          )}
        </div>
        <button className="navclose" onClick={onClose}><IconX size={15} /> Sair</button>
      </div>

      <div className="navdisc">
        Apoio à consciência situacional — <b>não substitui</b> instrumentos, cartas aeronáuticas nem o julgamento do comandante. Rumo/dist. verdadeiros (GPS).
        {txTs > 0 && Date.now() - txTs < 20000 && <span className="tx"> · ● transmitindo posição à regulação</span>}
      </div>
    </div>
  )
}
