import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import 'leaflet.gridlayer.googlemutant'
import { loadGoogleMaps } from '../lib/gmaps.js'

// camadas base disponíveis
const CARTO_DARK = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
const ESRI_IMAGERY = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
const CARTO_LABELS = 'https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png'

// ---- ícones SVG dos marcadores (html puro p/ L.divIcon) ----
const heliSvg =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h13"/><path d="M9.5 5v3"/><path d="M6 11.5c0-2 1.6-3.5 3.5-3.5h3c2.5 0 4.5 2 4.5 4.5v1a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-2z"/><path d="M17 12h3.2a1 1 0 0 0 .9-1.4L20 8"/><path d="M8 18.5h8"/><path d="M10 15.5v3M14 15.5v3"/></svg>'
const crossSvg =
  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>'

const baseIcon = () =>
  L.divIcon({ className: 'mk', html: `<div class="mk-base">${heliSvg}</div>`, iconSize: [34, 34], iconAnchor: [17, 17] })
const hospIcon = (sel, heliponto) =>
  L.divIcon({
    className: 'mk',
    html: `<div class="mk-hosp${sel ? ' sel' : ' dim'}">${crossSvg}${heliponto ? '<span class="hbadge">H</span>' : ''}</div>`,
    iconSize: [26, 26], iconAnchor: [13, 13],
  })
const helipadIcon = (landing) =>
  L.divIcon({ className: 'mk', html: `<div class="mk-helipad${landing ? ' landing' : ''}">H</div>`, iconSize: [24, 24], iconAnchor: [12, 12] })
const sceneIcon = () =>
  L.divIcon({ className: 'mk', html: '<div class="mk-scene"><span class="ring"></span><span class="core"></span></div>', iconSize: [34, 34], iconAnchor: [17, 17] })
const lzIcon = (letter, suitKey, sel) =>
  L.divIcon({
    className: 'mk',
    html: `<div class="mk-lz ${suitKey === 'restrita' ? 'restrita' : suitKey === 'avaliar' ? 'avaliar' : ''}${sel ? ' sel' : ''}">${letter}</div>`,
    iconSize: [25, 25], iconAnchor: [12.5, 12.5],
  })

export default function MapView({
  cfg, scene, hospitalId, landingHelipad, lz, lzSelId, manualLz, obstacles, route,
  mode, showObs, editMode, focus, baseLayer = 'dark', googleKey = '',
  onMapClick, onBaseMove, onPlaceMove,
}) {
  const divRef = useRef(null)
  const mapRef = useRef(null)
  const layerRef = useRef(null)
  const tileRef = useRef(null)   // camada base atual
  const labelsRef = useRef(null) // rótulos sobre o satélite (fallback híbrido)
  const modeRef = useRef(mode)
  const clickRef = useRef(onMapClick)
  const baseMoveRef = useRef(onBaseMove)
  const placeMoveRef = useRef(onPlaceMove)
  const fitKeyRef = useRef('')

  modeRef.current = mode
  clickRef.current = onMapClick
  baseMoveRef.current = onBaseMove
  placeMoveRef.current = onPlaceMove

  useEffect(() => {
    const m = L.map(divRef.current, { zoomControl: true }).setView([cfg.base.lat, cfg.base.lon], 10)
    m.on('click', (e) => clickRef.current && clickRef.current(e.latlng.lat, e.latlng.lng, modeRef.current))
    layerRef.current = L.layerGroup().addTo(m)
    mapRef.current = m
    return () => m.remove()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // camada base: escuro / satélite / híbrido — Google oficial com chave,
  // senão Esri World Imagery (Maxar) como fallback
  useEffect(() => {
    const m = mapRef.current
    if (!m) return
    let cancelled = false

    const clearBase = () => {
      if (tileRef.current) { m.removeLayer(tileRef.current); tileRef.current = null }
      if (labelsRef.current) { m.removeLayer(labelsRef.current); labelsRef.current = null }
    }

    const addEsri = (hybrid) => {
      clearBase()
      tileRef.current = L.tileLayer(ESRI_IMAGERY, {
        maxZoom: 19,
        attribution: 'Imagens &copy; Esri, Maxar, Earthstar Geographics',
      }).addTo(m)
      if (hybrid) {
        labelsRef.current = L.tileLayer(CARTO_LABELS, {
          maxZoom: 20, subdomains: 'abcd', attribution: '&copy; OpenStreetMap &copy; CARTO',
        }).addTo(m)
      }
    }

    if (baseLayer === 'dark') {
      clearBase()
      tileRef.current = L.tileLayer(CARTO_DARK, {
        maxZoom: 20, subdomains: 'abcd', attribution: '&copy; OpenStreetMap &copy; CARTO',
      }).addTo(m)
    } else if (googleKey) {
      loadGoogleMaps(googleKey)
        .then(() => {
          if (cancelled) return
          clearBase()
          tileRef.current = L.gridLayer
            .googleMutant({ type: baseLayer === 'hybrid' ? 'hybrid' : 'satellite', maxZoom: 21 })
            .addTo(m)
        })
        .catch(() => { if (!cancelled) addEsri(baseLayer === 'hybrid') })
    } else {
      addEsri(baseLayer === 'hybrid')
    }

    return () => { cancelled = true }
  }, [baseLayer, googleKey])

  // voar até um ponto (ex.: LZ escolhida na lista)
  useEffect(() => {
    if (focus && mapRef.current) mapRef.current.flyTo([focus.lat, focus.lon], Math.max(mapRef.current.getZoom(), 15), { duration: 0.8 })
  }, [focus])

  useEffect(() => {
    const m = mapRef.current
    const lay = layerRef.current
    if (!m || !lay) return
    lay.clearLayers()

    // base (sempre arrastável p/ calibrar)
    const baseMk = L.marker([cfg.base.lat, cfg.base.lon], { icon: baseIcon(), draggable: true, zIndexOffset: 500 })
      .bindTooltip(cfg.base.name + (cfg.base.verified ? '' : ' — posição aproximada, arraste p/ ajustar'))
    baseMk.on('dragend', (e) => {
      const p = e.target.getLatLng()
      baseMoveRef.current && baseMoveRef.current(p.lat, p.lng)
    })
    baseMk.addTo(lay)

    // hospitais
    for (const h of cfg.hospitals) {
      const sel = h.id === hospitalId
      const mk = L.marker([h.lat, h.lon], {
        icon: hospIcon(sel, h.heliponto),
        draggable: !!editMode,
        zIndexOffset: sel ? 400 : 100,
      }).bindTooltip(
        `${h.name}${h.heliponto ? ' · heliponto próprio' : ''}${editMode ? ' — arraste p/ ajustar' : ''}`
      )
      if (editMode) {
        mk.on('dragend', (e) => {
          const p = e.target.getLatLng()
          placeMoveRef.current && placeMoveRef.current('hospital', h.id, p.lat, p.lng)
        })
      }
      mk.addTo(lay)
    }

    // helipontos de apoio / rede privada
    for (const p of cfg.helipads || []) {
      const isLanding = landingHelipad && landingHelipad.id === p.id
      const mk = L.marker([p.lat, p.lon], {
        icon: helipadIcon(isLanding),
        draggable: !!editMode,
        zIndexOffset: isLanding ? 450 : 150,
      }).bindTooltip(`${p.name}${p.note ? ' — ' + p.note : ''}${editMode ? ' — arraste p/ ajustar' : ''}`)
      if (editMode) {
        mk.on('dragend', (e) => {
          const q = e.target.getLatLng()
          placeMoveRef.current && placeMoveRef.current('helipad', p.id, q.lat, q.lng)
        })
      }
      mk.addTo(lay)
    }

    // cena
    if (scene) {
      L.marker([scene.lat, scene.lon], { icon: sceneIcon(), zIndexOffset: 600 }).bindTooltip('Ocorrência').addTo(lay)
      L.circle([scene.lat, scene.lon], {
        radius: cfg.ops.lzRadiusM, color: '#22d3ee', weight: 1, fillOpacity: 0.02, dashArray: '4 7', opacity: 0.5,
      }).addTo(lay)
    }

    // candidatos a LZ
    if (scene && lz) {
      for (const c of lz) {
        const sel = c.id === lzSelId
        L.marker([c.lat, c.lon], { icon: lzIcon(c.letter, c.obstFlag ? 'avaliar' : c.suitKey, sel), zIndexOffset: sel ? 300 : 50 })
          .bindTooltip(`${c.letter} · ${c.name} (${c.type}) — ${c.distM} m da ocorrência`)
          .addTo(lay)
        if (sel && c.bounds) {
          L.rectangle(
            [[c.bounds.minlat, c.bounds.minlon], [c.bounds.maxlat, c.bounds.maxlon]],
            { color: '#34d399', weight: 2, fillOpacity: 0.08, dashArray: '5 5' }
          ).addTo(lay)
        } else if (sel) {
          L.circle([c.lat, c.lon], { radius: 60, color: '#34d399', weight: 2, fillOpacity: 0.08 }).addTo(lay)
        }
      }
    }
    if (manualLz) {
      L.marker([manualLz.lat, manualLz.lon], { icon: lzIcon('LZ', 'boa', true), zIndexOffset: 300 }).bindTooltip('LZ manual').addTo(lay)
    }

    // obstáculos
    if (showObs && obstacles) {
      for (const ln of obstacles.lines) {
        L.polyline(ln.coords.map((c) => [c.lat, c.lon]), { color: '#fbbf24', weight: 2, dashArray: '3 5', opacity: 0.75 })
          .bindTooltip('Rede elétrica (OSM)')
          .addTo(lay)
      }
      for (const p of obstacles.points) {
        L.circleMarker([p.lat, p.lon], { radius: 4, color: '#fbbf24', fillOpacity: 0.9 }).bindTooltip('Torre/mastro').addTo(lay)
      }
    }

    // rotas de voo
    const lzPt = manualLz || (lz || []).find((c) => c.id === lzSelId) || null
    const airPt = lzPt || scene
    const hosp = cfg.hospitals.find((h) => h.id === hospitalId)
    // ponto onde a aeronave pousa no destino
    const landPt = hosp ? (hosp.heliponto ? hosp : landingHelipad || hosp) : null
    if (airPt) {
      const pickup = cfg.ops.pickupEnabled ? cfg.hospitals.find((h) => h.id === cfg.ops.pickupHospitalId && h.heliponto) : null
      const pts = [[cfg.base.lat, cfg.base.lon]]
      if (pickup) pts.push([pickup.lat, pickup.lon])
      pts.push([airPt.lat, airPt.lon])
      L.polyline(pts, { color: '#22d3ee', weight: 7, opacity: 0.15 }).addTo(lay)
      L.polyline(pts, { color: '#22d3ee', weight: 2.5, opacity: 0.9 }).addTo(lay)
      if (landPt) {
        const leg2 = [[airPt.lat, airPt.lon], [landPt.lat, landPt.lon]]
        L.polyline(leg2, { color: '#22d3ee', weight: 7, opacity: 0.12 }).addTo(lay)
        L.polyline(leg2, { color: '#22d3ee', weight: 2.5, opacity: 0.9, dashArray: '9 7' }).addTo(lay)
      }
      // transbordo: heliponto de apoio -> hospital
      if (hosp && landPt && landPt !== hosp) {
        L.polyline([[landPt.lat, landPt.lon], [hosp.lat, hosp.lon]], {
          color: '#fb923c', weight: 2.5, opacity: 0.9, dashArray: '2 7',
        }).bindTooltip('Transbordo de ambulância até o hospital').addTo(lay)
      }
    }
    if (route && route.geo) {
      L.polyline(route.geo, { color: '#fb923c', weight: 3, opacity: 0.55 }).addTo(lay)
    }

    // enquadrar quando a cena muda
    const key = scene ? `${scene.lat.toFixed(4)},${scene.lon.toFixed(4)}|${hospitalId}|${landingHelipad?.id || ''}` : 'nada'
    if (key !== fitKeyRef.current) {
      fitKeyRef.current = key
      if (scene) {
        const b = L.latLngBounds([[cfg.base.lat, cfg.base.lon], [scene.lat, scene.lon]])
        if (hosp) b.extend([hosp.lat, hosp.lon])
        if (landPt) b.extend([landPt.lat, landPt.lon])
        m.fitBounds(b.pad(0.18))
      }
    }
  }, [cfg, scene, hospitalId, landingHelipad, lz, lzSelId, manualLz, obstacles, route, showObs, editMode])

  return (
    <>
      <div id="map" ref={divRef} />
      <div className="maplegend">
        <span><i style={{ background: '#34d399' }} /> LZ boa</span>
        <span><i style={{ background: '#fbbf24' }} /> avaliar</span>
        <span><i style={{ background: '#fb7185' }} /> restrita</span>
        <span><i style={{ background: '#7c3aed' }} /> heliponto</span>
        <span><i style={{ background: '#1d4ed8', borderRadius: 3 }} /> hospital</span>
      </div>
    </>
  )
}
