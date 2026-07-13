import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import GoogleMutant from 'leaflet.gridlayer.googlemutant'
import { loadGoogleMaps, googleAuthFailed, onGoogleAuthFailure } from '../lib/gmaps.js'
import { HELIPAD_CATALOG } from '../data/helipads-catalog.js'
import { haversineKm } from '../lib/geo.js'

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
    // estado do heliponto no próprio marcador: verde (com "H") vs âmbar dessaturado.
    // classe heli/noheli dirige borda + realce; "H" só aparece onde há heliponto.
    html: `<div class="mk-hosp ${heliponto ? 'heli' : 'noheli'}${sel ? ' sel' : ' dim'}">${crossSvg}${heliponto ? '<span class="hbadge">H</span>' : ''}</div>`,
    iconSize: [26, 26], iconAnchor: [13, 13],
  })
const helipadIcon = (landing) =>
  L.divIcon({ className: 'mk', html: `<div class="mk-helipad${landing ? ' landing' : ''}">H</div>`, iconSize: [24, 24], iconAnchor: [12, 12] })
// heliponto registrado ANAC (catálogo): círculo escuro c/ "H" ciano —
// mesma família visual dos helipontos (círculo-H), mas discreto: é
// infraestrutura registrada, não um ponto já coordenado da missão
const anacIcon = () =>
  L.divIcon({ className: 'mk', html: '<div class="mk-anac">H</div>', iconSize: [20, 20], iconAnchor: [10, 10] })
const sceneIcon = () =>
  L.divIcon({ className: 'mk', html: '<div class="mk-scene"><span class="ring"></span><span class="core"></span></div>', iconSize: [34, 34], iconAnchor: [17, 17] })
const lzIcon = (letter, suitKey, sel, isHeli) =>
  // candidato que é heliponto mantém a identidade círculo-H; a letra vira badge
  L.divIcon({
    className: 'mk',
    html: isHeli
      ? `<div class="mk-lz heli${sel ? ' sel' : ''}">H<span class="lzletter">${letter}</span></div>`
      : `<div class="mk-lz ${suitKey === 'restrita' ? 'restrita' : suitKey === 'avaliar' ? 'avaliar' : ''}${sel ? ' sel' : ''}">${letter}</div>`,
    iconSize: [25, 25], iconAnchor: [12.5, 12.5],
  })

export default function MapView({
  cfg, scene, hospitalId, landingHelipad, lz, lzSelId, manualLz, obstacles, route,
  mode, showObs, showPads = true, focus, baseLayer = 'dark', googleKey = '',
  onMapClick,
}) {
  const divRef = useRef(null)
  const mapRef = useRef(null)
  const layerRef = useRef(null)
  const tileRef = useRef(null)   // camada base atual
  const labelsRef = useRef(null) // rótulos sobre o satélite (fallback híbrido)
  const errPollRef = useRef(null) // vigia do aviso de erro do Google
  const modeRef = useRef(mode)
  const clickRef = useRef(onMapClick)
  const fitKeyRef = useRef('')

  modeRef.current = mode
  clickRef.current = onMapClick

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

    // se o Google recusar a chave depois de carregar (API não habilitada,
    // domínio não autorizado…), troca na hora para o satélite Esri
    const offAuthFail = onGoogleAuthFailure(() => {
      if (!cancelled && baseLayer !== 'dark') addEsri(baseLayer === 'hybrid')
    })

    if (baseLayer === 'dark') {
      clearBase()
      tileRef.current = L.tileLayer(CARTO_DARK, {
        maxZoom: 20, subdomains: 'abcd', attribution: '&copy; OpenStreetMap &copy; CARTO',
      }).addTo(m)
    } else if (googleKey && !googleAuthFailed()) {
      loadGoogleMaps(googleKey)
        .then(() => {
          if (cancelled || googleAuthFailed()) return
          clearBase()
          // o build ESM do plugin exporta a classe (a factory L.gridLayer.googleMutant é só do UMD)
          tileRef.current = new GoogleMutant({ type: baseLayer === 'hybrid' ? 'hybrid' : 'satellite', maxZoom: 21 }).addTo(m)
          // ApiNotActivated/BillingNotEnabled não disparam gm_authFailure.
          // Critério universal: se nenhum tile renderizou em 7s, usa o Esri.
          errPollRef.current = setTimeout(() => {
            if (cancelled) return
            const pane = m.getContainer().querySelector('.leaflet-tile-pane')
            const ok = pane && [...pane.querySelectorAll('img')].some((i) => i.complete && i.naturalWidth > 0)
            if (!ok) {
              console.warn('[skyrescue] satélite Google não renderizou (chave/API não habilitada?) — usando Esri')
              addEsri(baseLayer === 'hybrid')
            }
          }, 7000)
        })
        .catch((e) => {
          console.warn('[skyrescue] satélite Google indisponível, usando Esri:', e)
          if (!cancelled) addEsri(baseLayer === 'hybrid')
        })
    } else {
      addEsri(baseLayer === 'hybrid')
    }

    return () => {
      cancelled = true
      offAuthFail()
      if (errPollRef.current) { clearTimeout(errPollRef.current); errPollRef.current = null }
    }
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

    // base
    L.marker([cfg.base.lat, cfg.base.lon], { icon: baseIcon(), zIndexOffset: 500 })
      .bindTooltip(cfg.base.name)
      .addTo(lay)

    // hospitais
    for (const h of cfg.hospitals) {
      const sel = h.id === hospitalId
      L.marker([h.lat, h.lon], {
        icon: hospIcon(sel, h.heliponto),
        zIndexOffset: sel ? 400 : 100,
      }).bindTooltip(`${h.name}${h.heliponto ? ' · heliponto próprio' : ' · sem heliponto (transbordo terrestre)'}`)
        .addTo(lay)
    }

    // helipontos de apoio / rede privada
    for (const p of cfg.helipads || []) {
      const isLanding = landingHelipad && landingHelipad.id === p.id
      L.marker([p.lat, p.lon], {
        icon: helipadIcon(isLanding),
        zIndexOffset: isLanding ? 450 : 150,
      }).bindTooltip(`${p.name}${p.note ? ' — ' + p.note : ''}`)
        .addTo(lay)
    }

    // helipontos registrados ANAC (catálogo) — camada persistente, sempre no
    // mapa. Omite os que já têm marcador próprio: hospital com heliponto /
    // heliponto de apoio a <150 m, ou candidato de LZ com letra na cena atual.
    if (showPads) {
      const covered = [
        ...cfg.hospitals.filter((h) => h.heliponto),
        ...(cfg.helipads || []),
      ]
      for (const p of HELIPAD_CATALOG) {
        if (covered.some((c) => haversineKm(c, p) * 1000 < 150)) continue
        if (scene && (lz || []).some((c) => c.id === `cat/${p.icao}`)) continue
        L.marker([p.lat, p.lon], { icon: anacIcon(), zIndexOffset: 40 })
          .bindTooltip(`${p.name} [${p.icao}] · ${p.bairro} — registro ANAC, coordenar uso com o operador`)
          .addTo(lay)
      }
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
        L.marker([c.lat, c.lon], { icon: lzIcon(c.letter, c.obstFlag ? 'avaliar' : c.suitKey, sel, c.typeKey === 'heli'), zIndexOffset: sel ? 300 : 50 })
          .bindTooltip(`${c.letter} · ${c.name}${c.icao ? ' [' + c.icao + ']' : ''} (${c.type}) — ${c.distM} m da ocorrência`)
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
  }, [cfg, scene, hospitalId, landingHelipad, lz, lzSelId, manualLz, obstacles, route, showObs, showPads])

  return (
    <>
      <div id="map" ref={divRef} />
      <div className="maplegend">
        <span><i style={{ background: '#34d399' }} /> LZ boa</span>
        <span><i style={{ background: '#fbbf24' }} /> avaliar</span>
        <span><i style={{ background: '#fb7185' }} /> restrita</span>
        <span><b className="lg-hosp heli">H</b> hospital c/ heliponto</span>
        <span><b className="lg-hosp noheli" /> hospital s/ heliponto</span>
        <span><b className="lg-pad apoio">H</b> heliponto de apoio</span>
        <span><b className="lg-pad anac">H</b> heliponto ANAC</span>
      </div>
    </>
  )
}
