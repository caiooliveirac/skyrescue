import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import GoogleMutant from 'leaflet.gridlayer.googlemutant'
import { loadGoogleMaps, googleAuthFailed, onGoogleAuthFailure, watchMutant } from '../lib/gmaps.js'
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
// base SAMU (ambulância): quadrado-S vermelho discreto — é de onde parte a
// rota terrestre que alimenta a sugestão automática de ETA até a cena
const samuIcon = () =>
  L.divIcon({ className: 'mk', html: '<div class="mk-samu">S</div>', iconSize: [20, 20], iconAnchor: [10, 10] })
// ponto de pouso da comunidade: pendente = círculo-H âmbar tracejado
// (sugestão de usuário, aguarda admin); aprovado = cor padrão da base
// ponto da comunidade; o selo de câmera avisa que o local tem foto — quem
// for pousar sabe, olhando o mapa, que dá para ver o terreno antes de chegar
const camSvg =
  '<svg viewBox="0 0 24 24" width="8" height="8" fill="currentColor"><path d="M3 8.5h4l1.2-2h7.6L17 8.5h4V19H3z"/><circle cx="12" cy="13.5" r="3.6" fill="#22d3ee"/></svg>'
const commIcon = (approved, hasPhoto) =>
  L.divIcon({
    className: 'mk',
    html: `<div class="mk-comm${approved ? ' ok' : ''}">H${hasPhoto ? `<i class="commphoto-badge">${camSvg}</i>` : ''}</div>`,
    iconSize: [20, 20], iconAnchor: [10, 10],
  })
// aeronave em voo (posição reportada pelo modo navegação do piloto):
// seta apontando o rumo, mesma linguagem visual da tela do piloto
const acftSvg =
  '<svg viewBox="0 0 24 24" width="26" height="26"><path d="M12 2 L19.5 21 L12 16.6 L4.5 21 Z" fill="#22d3ee" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>'
const acftIcon = (track) =>
  L.divIcon({ className: 'mk', html: `<div class="mk-acft" style="transform:rotate(${track ?? 0}deg)">${acftSvg}</div>`, iconSize: [26, 26], iconAnchor: [13, 13] })
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
  mode, showObs, showPads = true, communityLz, aircraft, focus, baseLayer = 'dark', googleKey = '',
  onPointClick, photoCounts,
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
  const photoClickRef = useRef(onPointClick)
  const fitKeyRef = useRef('')

  modeRef.current = mode
  clickRef.current = onMapClick
  photoClickRef.current = onPointClick

  useEffect(() => {
    // rotateControl: o leaflet-rotate (carregado pelo modo navegação) injeta
    // uma bússola por padrão em todo mapa — aqui o mapa não gira, então fora
    const m = L.map(divRef.current, { zoomControl: true, rotateControl: false }).setView([cfg.base.lat, cfg.base.lon], 10)
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
    let pendingG = null // mutant adicionado mas ainda não confirmado/promovido

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
    } else {
      // Esri entra JÁ — sem tela vazia esperando o Google; a camada Google
      // assume quando (e se) confirmar tiles, senão o Esri fica
      addEsri(baseLayer === 'hybrid')
      if (googleKey && !googleAuthFailed()) {
        loadGoogleMaps(googleKey)
          .then(() => {
            if (cancelled || googleAuthFailed()) return
            // o build ESM do plugin exporta a classe (a factory L.gridLayer.googleMutant é só do UMD)
            const g = new GoogleMutant({ type: baseLayer === 'hybrid' ? 'hybrid' : 'satellite', maxZoom: 21 })
            pendingG = g
            errPollRef.current = watchMutant(
              g,
              () => {
                if (cancelled) return
                console.warn('[skyrescue] satélite Google não renderizou (chave/billing/API?) — ficando no Esri')
                m.removeLayer(g); pendingG = null
              },
              7000,
              () => {
                if (cancelled) return
                clearBase() // tira o Esri por baixo
                tileRef.current = g; pendingG = null
              }
            )
            g.addTo(m)
          })
          .catch((e) => console.warn('[skyrescue] satélite Google indisponível, usando Esri:', e))
      }
    }

    return () => {
      cancelled = true
      offAuthFail()
      if (pendingG) { m.removeLayer(pendingG); pendingG = null }
      if (errPollRef.current) { errPollRef.current(); errPollRef.current = null }
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


    // Foto em QUALQUER ponto de pouso: um toque no marcador abre "como o local
    // é". O selo de câmera é colado no elemento já renderizado, para não
    // duplicar a lógica em cada fábrica de ícone. Sem trava de modo — o clique
    // no marcador nunca chegaria ao mapa de qualquer forma (o Leaflet não o
    // propaga), então travar só criava clique morto.
    const withPhotos = (marker, ref, name, sub) => {
      const n = photoCounts?.[ref] || 0
      marker.on('click', (ev) => {
        L.DomEvent.stop(ev)
        photoClickRef.current?.({ ref, name, sub, count: n })
      })
      marker.on('add', () => {
        if (!n) return
        const el = marker.getElement()?.firstElementChild
        if (el && !el.querySelector('.commphoto-badge'))
          el.insertAdjacentHTML('beforeend', `<i class="commphoto-badge">${camSvg}</i>`)
      })
      return marker
    }

    // hospitais
    for (const h of cfg.hospitals) {
      const sel = h.id === hospitalId
      withPhotos(
        L.marker([h.lat, h.lon], {
          icon: hospIcon(sel, h.heliponto),
          zIndexOffset: sel ? 400 : 100,
        }).bindTooltip(`${h.name}${h.heliponto ? ' · heliponto próprio' : ' · sem heliponto (transbordo terrestre)'} — toque para ver/pôr foto`),
        `hosp/${h.id}`, h.name,
        h.heliponto ? 'Hospital com heliponto próprio' : 'Hospital sem heliponto — transbordo terrestre'
      ).addTo(lay)
    }

    // helipontos de apoio / rede privada
    for (const p of cfg.helipads || []) {
      const isLanding = landingHelipad && landingHelipad.id === p.id
      withPhotos(
        L.marker([p.lat, p.lon], {
          icon: helipadIcon(isLanding),
          zIndexOffset: isLanding ? 450 : 150,
        }).bindTooltip(`${p.name}${p.note ? ' — ' + p.note : ''} — toque para ver/pôr foto`),
        `pad/${p.id}`, p.name, p.note || 'Heliponto de apoio'
      ).addTo(lay)
    }

    // bases SAMU (ambulâncias) — origem do cálculo de rota terrestre
    // base → ocorrência usado na comparação terrestre × aéreo
    for (const b of cfg.ambBases || []) {
      L.marker([b.lat, b.lon], { icon: samuIcon(), zIndexOffset: 30 })
        .bindTooltip(`${b.name} — base SAMU (ambulância)`)
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
        withPhotos(
          L.marker([p.lat, p.lon], { icon: anacIcon(), zIndexOffset: 40 })
            .bindTooltip(`${p.name} [${p.icao}] · ${p.bairro} — registro ANAC — toque para ver/pôr foto`),
          `cat/${p.icao}`, `${p.name} [${p.icao}]`,
          `${p.bairro} · heliponto registrado na ANAC — coordenar uso com o operador`
        ).addTo(lay)
      }
    }

    // pontos de pouso da comunidade: pendentes em âmbar (sugestão de
    // usuário); aprovados na cor padrão — integram a base de pontos.
    // Omite os aprovados que já viraram candidato com letra na cena atual.
    if (showPads) {
      for (const p of communityLz || []) {
        if (p.status === 'rejeitado') continue
        if (scene && (lz || []).some((c) => c.id === `com/${p.id}`)) continue
        const pend = p.status === 'pendente'
        const author = p.created_by_name || p.created_by_username
        const nph = p.photo_count || 0
        withPhotos(
          L.marker([p.lat, p.lon], { icon: commIcon(!pend, nph > 0), zIndexOffset: pend ? 45 : 42 })
            .bindTooltip(
              `${p.name}${p.municipio ? ' · ' + p.municipio : ''} — ` +
              (pend ? 'sugestão da comunidade, aguardando validação' : 'ponto validado pela comunidade') +
              (author ? ` · por ${author}` : '') + ' — toque para ver/pôr foto'
            ),
          `com/${p.id}`, p.name,
          (p.municipio ? p.municipio + ' · ' : '') +
          (pend ? 'sugestão da comunidade, aguardando validação' : 'ponto validado pela comunidade') +
          (p.description ? ` — “${p.description}”` : '')
        ).addTo(lay)
      }
    }

    // aeronave em voo (rastreamento ao vivo do modo navegação)
    if (aircraft) {
      if (aircraft.trail?.length > 1) {
        L.polyline(aircraft.trail, { color: '#22d3ee', weight: 2, opacity: 0.4 }).addTo(lay)
      }
      const gs = aircraft.gs_kmh != null ? `${Math.round(aircraft.gs_kmh)} km/h · ` : ''
      L.marker([aircraft.lat, aircraft.lon], { icon: acftIcon(aircraft.track), zIndexOffset: 700 })
        .bindTooltip(`GOA em voo — ${gs}atualizado ${new Date(aircraft.reported_at).toLocaleTimeString('pt-BR')}${aircraft.reported_by_name || aircraft.reported_by_username ? ' · por ' + (aircraft.reported_by_name || aircraft.reported_by_username) : ''}`)
        .addTo(lay)
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
        withPhotos(
          L.marker([c.lat, c.lon], { icon: lzIcon(c.letter, c.obstFlag ? 'avaliar' : c.suitKey, sel, c.typeKey === 'heli'), zIndexOffset: sel ? 300 : 50 })
            .bindTooltip(`${c.letter} · ${c.name}${c.icao ? ' [' + c.icao + ']' : ''} (${c.type}) — ${c.distM} m da ocorrência — toque para ver/pôr foto`),
          String(c.id), `${c.letter} · ${c.name}`,
          `${c.type} · ${c.distM} m da ocorrência`
        ).addTo(lay)
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
  }, [cfg, scene, hospitalId, landingHelipad, lz, lzSelId, manualLz, obstacles, route, showObs, showPads, communityLz, aircraft, photoCounts])

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
        <span><b className="lg-pad comm">H</b> sugestão da comunidade (a validar)</span>
        <span><b className="lg-samu">S</b> base SAMU (ambulância)</span>
        <span><b className="lg-acft">➤</b> GOA em voo (ao vivo)</span>
      </div>
    </>
  )
}
