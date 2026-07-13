import { useEffect, useMemo, useRef, useState } from 'react'
import { loadCfg, saveCfg, TAG_LABELS, hospitalHelipads, landingPoints } from './config.js'
import { api } from './lib/backend.js'
import { geocode, reverseGeocode, fetchWeather, fetchMetar, groundRoute, overpass, lzQuery, obstacleQuery, heliRadius } from './lib/api.js'
import { catalogNear } from './data/helipads-catalog.js'
import { haversineKm, fmtMin, fmtCoords, fmtCoordsDMS, fmtCoordsDDM, gmapsLink } from './lib/geo.js'
import { computeMission, autoChecks, daylightCheck, rangeCheck, combinedWeatherStatus, classifyWeather } from './lib/mission.js'
import { computeScore, recommendation, evaluateGates, ITEM_BY_ID } from './lib/score.js'
import { rankLZ, parseObstacles } from './lib/lz.js'
import MapView from './components/MapView.jsx'
import NavMode from './components/NavMode.jsx'
import CommunityModal from './components/Community.jsx'
import Checklist from './components/Checklist.jsx'
import Tracking, { MILESTONES } from './components/Tracking.jsx'
import ConfigModal from './components/ConfigModal.jsx'
import { DecisionStrip, TimePanel, WeatherPanel, LZPanel, AlertsPanel, GatesPanel, CoordReadout } from './components/Results.jsx'
import {
  IconHeli, IconPlus, IconFolder, IconPrint, IconSettings, IconSearch, IconPin,
  IconTarget, IconZap, IconCopy, IconSave, IconDownload, IconHelipadH,
  IconClock, IconCloud, IconAlert, IconRoute, IconX, IconUsers,
} from './components/Icons.jsx'

export default function App({ user, onLogout }) {
  const [cfg, setCfg] = useState(loadCfg)
  const [showCfg, setShowCfg] = useState(false)
  const [showCases, setShowCases] = useState(false)

  // ocorrência
  const [scene, setScene] = useState(null)
  const [sceneLabel, setSceneLabel] = useState('')
  const [q, setQ] = useState('')
  const [geoResults, setGeoResults] = useState(null)
  const [geoBusy, setGeoBusy] = useState(false)
  const [caseId, setCaseId] = useState('')
  const [notes, setNotes] = useState('')

  // checklist
  const [manualChecked, setManualChecked] = useState({})
  const [autoOverrides, setAutoOverrides] = useState({})
  const [gateManual, setGateManual] = useState({})
  const [gateOverrides, setGateOverrides] = useState({})

  // recursos / destino
  const [hospitalId, setHospitalId] = useState(cfg.hospitals[0]?.id || '')
  const [landingSel, setLandingSel] = useState('auto') // 'auto' | 'lz' | id de heliponto
  const [ambEta, setAmbEta] = useState('')
  const [ambSug, setAmbSug] = useState(null)

  // dados externos
  const [wxScene, setWxScene] = useState(null)
  const [wxBase, setWxBase] = useState(null)
  const [wxErr, setWxErr] = useState(null)
  const [metar, setMetar] = useState(null)
  const [lzList, setLzList] = useState(null)
  const [lzErr, setLzErr] = useState(null)
  const [lzLoading, setLzLoading] = useState(false)
  const [obstacles, setObstacles] = useState(null)
  const [route, setRoute] = useState(null)
  const [routeErr, setRouteErr] = useState(null)

  const [lzSelId, setLzSelId] = useState(null)
  const [manualLz, setManualLz] = useState(null)
  const [mapMode, setMapMode] = useState('scene')
  const [showObs, setShowObs] = useState(false)
  const [showPads, setShowPads] = useState(true) // camada de helipontos ANAC
  const [focus, setFocus] = useState(null)
  const [baseLayer, setBaseLayer] = useState(() => {
    try { return localStorage.getItem('skyrescue_baselayer') || 'dark' } catch (e) { return 'dark' }
  })
  const pickBaseLayer = (v) => {
    setBaseLayer(v)
    try { localStorage.setItem('skyrescue_baselayer', v) } catch (e) { /* ok */ }
  }

  const [events, setEvents] = useState({})
  const [cases, setCases] = useState([])
  const [casesErr, setCasesErr] = useState('')
  const [dbId, setDbId] = useState(null) // id do caso no banco (null = ainda não salvo)
  const [saving, setSaving] = useState(false)
  const [saveFlash, setSaveFlash] = useState(false) // confirmação transitória de gravação
  const [saveErr, setSaveErr] = useState('')

  const refreshCases = async () => {
    try { const { cases } = await api.listCases(); setCases(cases); setCasesErr('') }
    catch (e) { setCasesErr(e.message || 'falha ao carregar casos') }
  }

  // pontos de pouso sugeridos pela comunidade (pendentes + validados)
  const [communityLz, setCommunityLz] = useState([])
  const [showComm, setShowComm] = useState(false)
  const [showNav, setShowNav] = useState(false) // modo navegação do piloto (GPS)
  const [commDraft, setCommDraft] = useState(null) // {lat, lon} clicado no mapa
  const communityRef = useRef([]) // leitura na busca de LZ sem refazer o Overpass a cada refresh
  communityRef.current = communityLz
  const refreshCommunity = async () => {
    try { const { points } = await api.listCommunityLz(); setCommunityLz(points) }
    catch (e) { /* camada opcional — segue sem ela */ }
  }
  useEffect(() => { refreshCases(); refreshCommunity() }, [])

  const seqRef = useRef(0)
  const routeSeqRef = useRef(0)
  const revGeoRef = useRef(0)      // invalida reverse-geocode de cliques antigos
  const pendingLzSelRef = useRef(null) // preserva lzSelId restaurado por loadCase

  const hospital = cfg.hospitals.find((h) => h.id === hospitalId) || null

  // a topbar pode quebrar em 2 linhas — o offset da faixa sticky segue a altura real
  useEffect(() => {
    const tb = document.querySelector('.topbar')
    if (!tb || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() =>
      document.documentElement.style.setProperty('--topbar-h', tb.offsetHeight + 'px')
    )
    ro.observe(tb)
    return () => ro.disconnect()
  }, [])

  // heliponto de desembarque quando o hospital não tem heliponto próprio
  const assocHelipads = hospitalHelipads(cfg, hospital)
  const landingHelipad = useMemo(() => {
    if (!hospital || hospital.heliponto || landingSel === 'lz') return null
    if (landingSel === 'auto') return assocHelipads[0] || null
    return landingPoints(cfg).find((p) => p.id === landingSel) || null
    // eslint-disable-next-line
  }, [hospitalId, landingSel, cfg])

  // heliponto excluído na Config não pode ficar selecionado
  useEffect(() => {
    if (landingSel !== 'auto' && landingSel !== 'lz' && !landingPoints(cfg).some((p) => p.id === landingSel)) {
      setLandingSel('auto')
    }
  }, [cfg, landingSel])

  // ---------- busca de dados quando a cena muda ----------
  useEffect(() => {
    if (!scene) return
    const seq = ++seqRef.current
    setWxScene(null); setWxErr(null); setMetar(null)
    setLzList(null); setLzErr(null); setLzLoading(true); setObstacles(null)
    // preserva a LZ restaurada por loadCase; limpa nos demais casos
    setLzSelId(pendingLzSelRef.current); pendingLzSelRef.current = null

    fetchWeather(scene.lat, scene.lon)
      .then((w) => seq === seqRef.current && setWxScene(w))
      .catch((e) => seq === seqRef.current && setWxErr(e.message || String(e)))
    fetchMetar().then((m) => seq === seqRef.current && setMetar(m))

    // pontos validados da comunidade perto da cena entram no ranking de LZ
    // (mesmo raio ampliado dos helipontos: são pousos de rotina da equipe)
    const commNear = communityRef.current.filter(
      (p) => p.status === 'aprovado' && haversineKm(scene, p) * 1000 <= heliRadius(cfg.ops.lzRadiusM)
    )

    ;(async () => {
      try {
        const [lzEls, obEls] = await Promise.all([
          overpass(lzQuery(scene.lat, scene.lon, cfg.ops.lzRadiusM)),
          overpass(obstacleQuery(scene.lat, scene.lon, cfg.ops.lzRadiusM + 300)),
        ])
        if (seq !== seqRef.current) return
        const obs = parseObstacles(obEls)
        setObstacles(obs)
        setLzList(rankLZ(lzEls, scene, obs, { catalog: catalogNear(scene, heliRadius(cfg.ops.lzRadiusM)), community: commNear }))
      } catch (e) {
        if (seq === seqRef.current) {
          setLzErr(e.message || String(e))
          // OSM fora do ar não apaga os pontos conhecidos (catálogo + comunidade)
          const cat = catalogNear(scene, heliRadius(cfg.ops.lzRadiusM))
          if (cat.length || commNear.length) setLzList(rankLZ([], scene, null, { catalog: cat, community: commNear }))
        }
      } finally {
        if (seq === seqRef.current) setLzLoading(false)
      }
    })()
  }, [scene, cfg.ops.lzRadiusM]) // eslint-disable-line

  // meteo da base em efeito próprio: arrastar a base não zera LZ/cena
  useEffect(() => {
    if (!scene) return
    let alive = true
    setWxBase(null)
    fetchWeather(cfg.base.lat, cfg.base.lon)
      .then((w) => alive && setWxBase(w))
      .catch(() => {})
    return () => { alive = false }
  }, [scene, cfg.base.lat, cfg.base.lon])

  // rota terrestre cena -> hospital (Google Routes c/ trânsito, OSRM reserva)
  useEffect(() => {
    setRoute(null); setRouteErr(null)
    if (!scene || !hospital) return
    const seq = ++routeSeqRef.current
    groundRoute(scene, hospital, cfg.map?.googleKey)
      .then((r) => seq === routeSeqRef.current && setRoute(r))
      .catch((e) => seq === routeSeqRef.current && setRouteErr(e.message || String(e)))
  }, [scene, hospitalId, hospital?.lat, hospital?.lon, cfg.map?.googleKey]) // eslint-disable-line

  // sugestão de ETA de ambulância a partir das bases cadastradas
  useEffect(() => {
    setAmbSug(null)
    if (!scene || !cfg.ambBases?.length) return
    const nearest = cfg.ambBases
      .map((b) => ({ ...b, dKm: haversineKm(b, scene) }))
      .sort((a, b) => a.dKm - b.dKm)
      .slice(0, 3)
    Promise.all(
      nearest.map((b) =>
        groundRoute(b, scene, cfg.map?.googleKey)
          .then((r) => ({ name: b.name, min: Math.round(r.durMin * (r.traffic ? 1 : cfg.ground.trafficFactor)) }))
          .catch(() => null)
      )
    ).then((rs) => setAmbSug(rs.filter(Boolean).sort((a, b) => a.min - b.min)))
  }, [scene, cfg.ambBases, cfg.ground.trafficFactor, cfg.map?.googleKey]) // eslint-disable-line

  // ---------- cálculo ----------
  const lzPoint = manualLz || (lzList || []).find((c) => c.id === lzSelId) || null
  const mission = useMemo(
    () =>
      computeMission({
        cfg,
        scene,
        hospital,
        lzPoint: lzPoint ? { lat: lzPoint.lat, lon: lzPoint.lon } : null,
        landingHelipad,
        groundRoute: route,
        ambulanceEtaMin: ambEta === '' ? null : Number(ambEta),
      }),
    [cfg, scene, hospital, lzPoint, landingHelipad, route, ambEta]
  )
  const autos = useMemo(() => autoChecks(mission), [mission])

  const isChecked = (id) => {
    const item = ITEM_BY_ID[id]
    if (item?.auto) {
      if (autoOverrides[id] !== undefined) return autoOverrides[id]
      return autos[id] === true
    }
    return !!manualChecked[id]
  }
  const isOverridden = (id) => autoOverrides[id] !== undefined
  const toggleItem = (id) => {
    const item = ITEM_BY_ID[id]
    if (item?.auto) setAutoOverrides((p) => ({ ...p, [id]: !isChecked(id) }))
    else setManualChecked((p) => ({ ...p, [id]: !p[id] }))
  }
  const resetAuto = (id) => setAutoOverrides((p) => { const n = { ...p }; delete n[id]; return n })

  const score = useMemo(() => computeScore(isChecked), [manualChecked, autoOverrides, autos]) // eslint-disable-line

  const daylight = useMemo(
    () =>
      daylightCheck({
        sunsetISO: wxScene?.sunset || wxBase?.sunset,
        // janela VFR precisa cobrir também o voo de retorno à base
        airTotalMin: mission?.missionEndMin ?? mission?.airTotal,
        nightAllowed: cfg.ops.nightAllowed,
        marginMin: cfg.ops.sunsetMarginMin,
      }),
    [wxScene, wxBase, mission, cfg.ops.nightAllowed, cfg.ops.sunsetMarginMin]
  )

  const lzStatus = useMemo(() => {
    if (manualLz) return 'ok'
    if (lzErr) return 'unknown'
    if (!lzList) return scene ? 'unknown' : 'unknown'
    if (!lzList.length) return 'fail'
    return lzList.some((c) => c.suitKey !== 'restrita' && !c.obstFlag) ? 'ok' : 'warn'
  }, [lzList, lzErr, manualLz, scene])

  const autoStatus = {
    weather: !scene ? 'unknown' : (!wxScene && !wxErr ? 'unknown' : combinedWeatherStatus(wxScene, wxBase)),
    daylight: daylight.status,
    lz: lzStatus,
    range: rangeCheck(mission?.missionKm, cfg.aircraft).status,
  }
  const gates = useMemo(
    () => evaluateGates(autoStatus, gateManual, gateOverrides),
    // eslint-disable-next-line
    [JSON.stringify(autoStatus), gateManual, gateOverrides]
  )
  const rec = scene ? recommendation(score, gates) : null

  // hospitais sugeridos pelo perfil clínico
  const wantedTags = useMemo(() => {
    const t = new Set()
    if (isChecked('c_trauma') || isChecked('g_energia') || isChecked('g_tce') || isChecked('g_fraturas')) t.add('trauma')
    if (isChecked('c_neuro') || isChecked('g_tce')) t.add('neuro')
    if (isChecked('c_hemo') || isChecked('g_iam')) t.add('hemodinamica')
    if (isChecked('g_iam')) t.add('iam')
    if (isChecked('g_avc')) t.add('avc')
    if (isChecked('c_queimados') || isChecked('g_queimadura')) t.add('queimados')
    if (isChecked('c_utiped') || isChecked('g_ped_trauma') || isChecked('g_ped_choque') || isChecked('g_ped_sepse') || isChecked('g_ped_resp')) t.add('ped')
    if (isChecked('g_ob_hemorragia') || isChecked('g_ob_eclampsia') || isChecked('g_ob_emergencia')) t.add('obst')
    return t
    // eslint-disable-next-line
  }, [manualChecked, autoOverrides, autos])

  // ---------- alertas ----------
  const alerts = useMemo(() => {
    const out = []
    if (!cfg.base.verified) out.push({ level: 'warn', text: 'Posição da base aérea é aproximada — ajuste em Config.' })
    if (hospital && !hospital.verified) out.push({ level: 'info', text: `Posição de ${hospital.name} é aproximada — ajuste em Config.` })
    if (hospital && !hospital.heliponto) {
      if (landingHelipad) {
        out.push({ level: 'info', text: `${hospital.name} sem heliponto próprio: desembarque no ${landingHelipad.name} + transbordo de ambulância (+${cfg.times.transbordoMin} min).${landingHelipad.kind === 'privado' ? ' Heliponto da rede privada — coordenar previamente o uso.' : ''}` })
      } else {
        out.push({ level: 'info', text: `${hospital.name} sem heliponto operacional: previsto pouso em LZ + transbordo (+${cfg.times.transbordoMin} min).` })
      }
    }
    if (lzPoint && scene) {
      const d = Math.round(haversineKm(scene, lzPoint) * 1000)
      if (d > 800) out.push({ level: 'warn', text: `LZ selecionada a ${d} m do paciente — considerar tempo/meio de deslocamento da equipe.` })
    }
    if (lzPoint && lzPoint.obstFlag) out.push({ level: 'warn', text: `LZ selecionada tem ${lzPoint.obstWhat} a ~${lzPoint.obstNear} m — reconhecimento visual obrigatório.` })
    if (daylight.status === 'warn' || daylight.status === 'fail') out.push({ level: daylight.status === 'fail' ? 'fail' : 'warn', text: daylight.note })
    if (autoStatus.weather === 'warn') out.push({ level: 'warn', text: 'Meteorologia marginal — validar com o GOA/piloto antes de progredir.' })
    if (autoStatus.weather === 'fail') out.push({ level: 'fail', text: 'Meteorologia desfavorável detectada (ver painel).' })
    if (routeErr) out.push({ level: 'warn', text: 'Falha ao calcular rota terrestre (OSRM). Tempos terrestres indisponíveis.' })
    if (cfg.ops.pickupEnabled && scene && mission && !mission.pickup) out.push({ level: 'warn', text: 'Embarque de equipe SAMU habilitado, mas o heliponto de embarque configurado não é válido (hospital sem heliponto próprio?). Ajuste em Config.' })
    if (mission && mission.delta != null && mission.delta <= 0) out.push({ level: 'info', text: 'Neste cenário a via terrestre chega antes — o aéreo tende a não compensar.' })
    if (rangeCheck(mission?.missionKm, cfg.aircraft).status === 'fail') out.push({ level: 'fail', text: rangeCheck(mission.missionKm, cfg.aircraft).note })
    return out
  }, [cfg, hospital, landingHelipad, lzPoint, scene, daylight, autoStatus.weather, routeErr, mission])

  // ---------- ações ----------
  const doSearch = async () => {
    if (!q.trim()) return
    setGeoBusy(true); setGeoResults(null)
    try {
      const m = q.trim().match(/^(-?\d+[.,]\d+)[,;\s]+(-?\d+[.,]\d+)$/)
      if (m) {
        selectPlace({ lat: parseFloat(m[1].replace(',', '.')), lon: parseFloat(m[2].replace(',', '.')), label: 'Coordenadas informadas' })
      } else {
        const r = await geocode(q + (q.toLowerCase().includes('bahia') || q.toLowerCase().includes(' ba') ? '' : ', Bahia'))
        setGeoResults(r.length ? r : [])
      }
    } catch (e) {
      setGeoResults([])
    } finally {
      setGeoBusy(false)
    }
  }

  const selectPlace = (r) => {
    revGeoRef.current++
    setScene({ lat: r.lat, lon: r.lon })
    setSceneLabel(r.label)
    setGeoResults(null)
    setManualLz(null)
  }

  const onMapClick = async (lat, lon, mode) => {
    if (mode === 'suggest') {
      // clique só dá o ponto de partida — as coordenadas seguem editáveis no formulário
      setCommDraft({ lat, lon })
      setShowComm(true)
      setMapMode('scene')
    } else if (mode === 'lz') {
      setManualLz({ lat, lon })
      setLzSelId(null)
      setMapMode('scene')
    } else {
      const seq = ++revGeoRef.current
      setScene({ lat, lon })
      setSceneLabel('Ponto marcado no mapa')
      setManualLz(null)
      setGeoResults(null)
      const lbl = await reverseGeocode(lat, lon)
      if (lbl && seq === revGeoRef.current) setSceneLabel(lbl)
    }
  }

  const markEvent = (id) => setEvents((p) => ({ ...p, [id]: Date.now() }))
  const editEvent = (id, hhmm) => {
    if (!hhmm) return // campo limpo durante a edição — mantém o horário anterior
    const [h, m] = hhmm.split(':').map(Number)
    if (!Number.isFinite(h) || !Number.isFinite(m)) return
    const d = new Date(); d.setHours(h, m, 0, 0)
    setEvents((p) => ({ ...p, [id]: d.getTime() }))
  }

  const destinoLabel = () => {
    if (!hospital) return '—'
    if (hospital.heliponto) return `${hospital.name} (heliponto próprio)`
    if (landingHelipad) return `${hospital.name} (desembarque: ${landingHelipad.name} + transbordo)`
    return `${hospital.name} (sem heliponto → LZ + transbordo)`
  }

  const resumoText = () => {
    const L = []
    L.push('SKYRESCUE — RESUMO DE ACIONAMENTO')
    L.push(`${new Date().toLocaleString('pt-BR')}  ${caseId ? '· Caso ' + caseId : ''}`)
    if (scene) {
      L.push(`Local: ${sceneLabel || '—'}`)
      L.push(`Coords (DDM): ${fmtCoordsDDM(scene)}  |  dec ${fmtCoords(scene)}`)
      L.push(`Maps: ${gmapsLink(scene)}`)
    }
    L.push(`Score: ${score.total} pts — ${score.band.label}`)
    const hits = Object.values(score.perSection).flatMap((s) => s.hits)
    if (hits.length) L.push(`Critérios: ${hits.join('; ')}`)
    if (!gates.ok) L.push(`IMPEDITIVOS: ${gates.fails.map((f) => f.label).join('; ')}`)
    if (mission?.airTotal != null) L.push(`Tempo aéreo estimado: ${fmtMin(mission.airTotal)}${mission.ground.total != null ? ` × terrestre ${fmtMin(mission.ground.total)} (Δ ${fmtMin(Math.abs(mission.delta))})` : ''}`)
    if (hospital) L.push(`Destino: ${destinoLabel()}`)
    if (landingHelipad) L.push(`Heliponto de desembarque: ${landingHelipad.name} — ${fmtCoordsDDM(landingHelipad)} (dec ${fmtCoords(landingHelipad)})`)
    if (lzPoint) L.push(`LZ: ${manualLz ? 'manual' : `${lzPoint.letter} — ${lzPoint.name}`} — ${fmtCoordsDDM(lzPoint)} (dec ${fmtCoords(lzPoint)})${lzPoint.obstFlag ? ' ⚠ obstáculo próximo' : ''}`)
    if (wxScene) {
      const c = classifyWeather(wxScene)
      L.push(`Meteo cena: ${c.level === 'ok' ? 'favorável' : c.level === 'warn' ? 'MARGINAL' : 'DESFAVORÁVEL'} — vento ${Math.round(wxScene.windKmh || 0)} km/h, vis ${wxScene.visM != null ? (wxScene.visM / 1000).toFixed(1) + ' km' : 's/ dado'}`)
    }
    if (wxScene?.sunset) L.push(`Pôr do sol: ${new Date(wxScene.sunset).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`)
    return L.join('\n')
  }

  const copyResumo = async () => {
    const t = resumoText()
    try {
      await navigator.clipboard.writeText(t)
      alert('Resumo copiado!')
    } catch (e) {
      window.prompt('Copie o resumo:', t)
    }
  }

  const snapshot = () => ({
    v: 2,
    id: caseId || 'caso-' + new Date().toISOString().slice(0, 19).replace('T', '-').replace(/:/g, ''),
    ts: Date.now(),
    scene, sceneLabel, hospitalId, hospitalName: hospital?.name || null, landingSel, ambEta, notes,
    manualChecked, autoOverrides, gateManual, gateOverrides,
    lzSelId, manualLz, events,
    scoreTotal: score.total, band: score.band.key,
    recommendation: rec?.title || null, gatesOk: gates.ok,
    mission: mission ? { airTotal: mission.airTotal, groundTotal: mission.ground.total, delta: mission.delta } : null,
  })

  // grava no servidor (Postgres). dbId != null => atualiza o mesmo caso.
  const saveCase = async () => {
    if (saving) return
    setSaving(true)
    setSaveErr('')
    const snap = snapshot()
    if (!caseId) setCaseId(snap.id)
    try {
      if (dbId != null) {
        await api.updateCase(dbId, snap)
      } else {
        const { id } = await api.createCase(snap)
        setDbId(id)
      }
      await refreshCases()
      setSaveFlash(true)
      setTimeout(() => setSaveFlash(false), 4000)
    } catch (e) {
      setSaveErr(e.message || String(e))
    } finally {
      setSaving(false)
    }
  }

  // carrega o snapshot completo do banco e restaura o estado do app
  const loadCase = async (row) => {
    try {
      const { case: full } = await api.getCase(row.id)
      const c = full.snapshot || {}
      revGeoRef.current++
      pendingLzSelRef.current = c.scene ? c.lzSelId || null : null
      setDbId(row.id)
      setCaseId(c.id || ''); setSceneLabel(c.sceneLabel); setScene(c.scene)
      const hospOk = cfg.hospitals.some((h) => h.id === c.hospitalId)
      setHospitalId(hospOk ? c.hospitalId : cfg.hospitals[0]?.id || '')
      setLandingSel(c.landingSel || 'auto'); setAmbEta(c.ambEta); setNotes(c.notes || '')
      setManualChecked(c.manualChecked || {}); setAutoOverrides(c.autoOverrides || {})
      setGateManual(c.gateManual || {}); setGateOverrides(c.gateOverrides || {})
      setLzSelId(c.lzSelId || null); setManualLz(c.manualLz || null); setEvents(c.events || {})
      setSaveFlash(false); setSaveErr('')
      setShowCases(false)
    } catch (e) {
      alert('Falha ao abrir o caso: ' + (e.message || e))
    }
  }

  const deleteCase = async (row) => {
    if (!confirm(`Excluir o caso ${row.case_ref || row.id} do servidor?`)) return
    try {
      await api.deleteCase(row.id)
      if (dbId === row.id) setDbId(null)
      await refreshCases()
    } catch (e) {
      alert('Falha ao excluir: ' + (e.message || e))
    }
  }

  const doLogout = async () => {
    try { await api.logout() } catch (e) { /* segue mesmo assim */ }
    onLogout?.()
  }

  const exportJSON = () => {
    const blob = new Blob([JSON.stringify(snapshot(), null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = (caseId || 'skyrescue-caso') + '.json'
    a.click()
  }

  const newCase = () => {
    revGeoRef.current++
    setDbId(null); setSaveFlash(false); setSaveErr('')
    setScene(null); setSceneLabel(''); setQ(''); setCaseId(''); setNotes(''); setGeoResults(null)
    setManualChecked({}); setAutoOverrides({}); setGateManual({}); setGateOverrides({})
    setAmbEta(''); setLzSelId(null); setManualLz(null); setEvents({}); setLandingSel('auto')
    setHospitalId(cfg.hospitals[0]?.id || '')
    setWxScene(null); setWxBase(null); setMetar(null); setLzList(null); setObstacles(null); setRoute(null)
  }

  // ---------- render ----------
  return (
    <>
      <div className="topbar">
        <div className="brand">
          <div className="logo-mark"><IconHeli size={21} /></div>
          <div>
            <div className="logo-word">SkyRescue<span className="beta">BETA</span></div>
            <div className="sub">Apoio à decisão aeromédica · SAMU 192 Salvador × GOA/CBMBA</div>
          </div>
        </div>
        <div className="spacer" />
        <button className="tbtn" onClick={newCase}><IconPlus size={14} /> Novo caso</button>
        <button className="tbtn" onClick={() => setShowCases(true)}><IconFolder size={14} /> Casos ({cases.length})</button>
        <button className="tbtn" onClick={() => window.print()}><IconPrint size={14} /> Registro</button>
        <button className="tbtn" onClick={() => setShowCfg(true)}><IconSettings size={14} /> Config</button>
        {user && <span className="who" title={user.role}>{user.full_name || user.username}</span>}
        <button className="tbtn" onClick={doLogout} title="Encerrar sessão"><IconX size={14} /> Sair</button>
      </div>

      <DecisionStrip scene={scene} score={score} gates={gates} rec={rec} onCopy={copyResumo} />

      {!cfg.base.verified && (
        <div className="notice">
          <b>Primeiro uso:</b> confirme a posição da base do GOA e as posições de hospitais/helipontos na tela <b>Config</b>.
        </div>
      )}

      <div className="wrap">
        {/* -------- coluna esquerda: avaliação -------- */}
        <div className="col">
          <div className="card">
            <h2><span className="step-num">1</span> Local da ocorrência</h2>
            <div className="row">
              <input
                type="text"
                placeholder="Endereço, rodovia c/ km, cidade — ou lat, lon"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && doSearch()}
                style={{ flex: 1 }}
              />
              <button className="btn" onClick={doSearch} disabled={geoBusy}>{geoBusy ? <span className="spin" /> : <><IconSearch size={14} /> Buscar</>}</button>
            </div>
            <div className="small" style={{ marginTop: 5 }}>…ou clique direto no mapa.</div>
            {geoResults && (
              <div className="geo-results">
                {geoResults.length === 0 && <button disabled>Nenhum resultado — tente outro termo ou clique no mapa</button>}
                {geoResults.map((r, i) => (
                  <button key={i} onClick={() => selectPlace(r)}>{r.label}</button>
                ))}
              </div>
            )}
            {scene && (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontWeight: 700, fontSize: 13.5, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <IconPin size={14} style={{ color: 'var(--fail)' }} /> {sceneLabel || 'Ponto marcado'}
                </div>
                <CoordReadout point={scene} label="Coordenadas" />
                <div className="mono small" style={{ marginTop: 3 }}>{fmtCoordsDMS(scene)}</div>
              </div>
            )}
            <div className="field" style={{ marginTop: 10, marginBottom: 0 }}>
              <label>Identificador do caso (não usar dados pessoais do paciente)</label>
              <input type="text" value={caseId} onChange={(e) => setCaseId(e.target.value)} placeholder="ex.: 2026-0707-014" />
            </div>
          </div>

          <div className="card" style={{ paddingBottom: 10 }}>
            <h2>
              <span className="step-num">2</span> Pontuação de elegibilidade
              <span className={'badge ' + (score.total >= 9 ? 'fail' : score.total >= 5 ? 'warn' : score.total > 0 ? 'ok' : '')}>{score.total} pts</span>
            </h2>
            <div className="small" style={{ marginBottom: 4 }}>
              Marque o que se aplica — itens <span className="auto-tag" style={{ fontStyle: 'normal' }}>AUTO</span> são calculados pelos tempos e podem ser sobrescritos.
            </div>
          </div>
          <Checklist isChecked={isChecked} isOverridden={isOverridden} onToggle={toggleItem} onReset={resetAuto} score={score} />

          <div className="card">
            <h2><span className="step-num">3</span> Condições operacionais (gates)</h2>
            <GatesPanel gates={gates} manualVals={gateManual} onManual={(id, v) => setGateManual((p) => ({ ...p, [id]: v }))} onOverride={(id, v) => setGateOverrides((p) => { const n = { ...p }; if (v) n[id] = v; else delete n[id]; return n })} />
          </div>

          <div className="card">
            <h2>Observações da regulação</h2>
            <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="mecanismo, achados, decisão, contatos…" style={{ width: '100%' }} />
          </div>
        </div>

        {/* -------- coluna direita: mapa e operação -------- */}
        <div className="col">
          <div className="card mapbox">
            <div className="mapmode">
              <button className={mapMode === 'scene' ? 'on' : ''} onClick={() => setMapMode('scene')}><IconPin size={13} /> Ocorrência</button>
              <button className={mapMode === 'lz' ? 'on' : ''} onClick={() => setMapMode(mapMode === 'lz' ? 'scene' : 'lz')}><IconTarget size={13} /> Marcar LZ</button>
              <button className={showObs ? 'on' : ''} onClick={() => setShowObs(!showObs)}><IconZap size={13} /> Obstáculos</button>
              <button className={showPads ? 'on' : ''} onClick={() => setShowPads(!showPads)} title="Helipontos registrados ANAC/CIAD e pontos da comunidade"><IconHelipadH size={13} /> Helipontos</button>
              <button className={mapMode === 'suggest' ? 'on' : ''} onClick={() => setShowComm(true)} title="Pontos de pouso sugeridos pela comunidade">
                <IconUsers size={13} /> {mapMode === 'suggest' ? 'Clique no local do pouso…' : 'Comunidade'}
              </button>
            </div>
            <MapView
              cfg={cfg} scene={scene} hospitalId={hospitalId} landingHelipad={landingHelipad}
              lz={lzList} lzSelId={lzSelId} manualLz={manualLz}
              obstacles={obstacles} route={route} mode={mapMode} showObs={showObs} showPads={showPads}
              communityLz={communityLz}
              focus={focus}
              baseLayer={baseLayer} googleKey={cfg.map?.googleKey || ''}
              onMapClick={onMapClick}
            />
            <div className="maplayers">
              <button className={baseLayer === 'dark' ? 'on' : ''} onClick={() => pickBaseLayer('dark')}>Mapa</button>
              <button className={baseLayer === 'sat' ? 'on' : ''} onClick={() => pickBaseLayer('sat')}>Satélite</button>
              <button className={baseLayer === 'hybrid' ? 'on' : ''} onClick={() => pickBaseLayer('hybrid')}>Híbrido</button>
            </div>
            <button className="navlaunch" onClick={() => setShowNav(true)} title="Modo navegação do piloto — posição GPS ao vivo, rumo e ETE">
              <IconRoute size={15} /> Navegar
            </button>
          </div>

          <div className="card">
            <h2><span className="step-num">4</span> Destino e operação</h2>
            <div className="field">
              <label>Hospital de destino</label>
              <select value={hospitalId} onChange={(e) => { setHospitalId(e.target.value); setLandingSel('auto') }}>
                {cfg.hospitals.map((h) => {
                  const sug = h.tags?.some((t) => wantedTags.has(t))
                  return (
                    <option key={h.id} value={h.id}>
                      {sug ? '★ ' : ''}{h.name}{h.heliponto ? ' · heliponto próprio' : ''}{h.tags?.length ? ` — ${h.tags.map((t) => TAG_LABELS[t] || t).join('/')}` : ''}
                    </option>
                  )
                })}
              </select>
              {hospital?.note && <div className="small">{hospital.note}</div>}
              {[...wantedTags].length > 0 && <div className="small">★ = compatível com o perfil clínico marcado</div>}
            </div>

            {hospital && !hospital.heliponto && (
              <div className="field">
                <label>Heliponto de desembarque (transbordo até {hospital.name})</label>
                <select value={landingSel} onChange={(e) => setLandingSel(e.target.value)}>
                  <option value="auto">
                    {assocHelipads.length ? `Padrão — ${assocHelipads[0].name}` : 'LZ próxima ao hospital + transbordo'}
                  </option>
                  {landingPoints(cfg).map((p) => (
                    <option key={p.id} value={p.id}>
                      {hospital.helipadIds?.includes(p.id) ? '★ ' : ''}{p.name}{p.kind === 'privado' ? ' · rede privada' : ''}
                    </option>
                  ))}
                  <option value="lz">Pousar em LZ próxima + transbordo</option>
                </select>
                {landingHelipad?.note && <div className="small">{landingHelipad.note}</div>}
                {landingHelipad && <CoordReadout point={landingHelipad} label={landingHelipad.name} />}
              </div>
            )}

            <div className="field" style={{ marginBottom: 0 }}>
              <label>ETA da ambulância mais próxima até a cena (min)</label>
              <input type="number" min="0" value={ambEta} onChange={(e) => setAmbEta(e.target.value)} placeholder="informe o tempo estimado" />
              {ambSug && ambSug.length > 0 && (
                <div className="row">
                  {ambSug.map((s, i) => (
                    <button key={i} className="btn xs sec" onClick={() => setAmbEta(String(s.min))}>usar {s.name}: {s.min} min</button>
                  ))}
                </div>
              )}
              {!cfg.ambBases?.length && <div className="small">Dica: cadastre bases SAMU em Config para sugestão automática.</div>}
            </div>
          </div>

          <div className="card">
            <h2><IconClock size={14} /> Tempos estimados {route == null && scene && !routeErr ? <span className="spin" /> : null}</h2>
            <TimePanel mission={mission} />
          </div>

          {scene && (
            <div className="card">
              <h2><IconTarget size={14} /> Áreas de pouso próximas à ocorrência</h2>
              <LZPanel
                lz={lzList} lzErr={lzErr} lzLoading={lzLoading} lzSelId={lzSelId} manualLz={manualLz}
                onSelect={(id) => { setLzSelId(id === lzSelId ? null : id); setManualLz(null) }}
                onFocus={(c) => setFocus({ lat: c.lat, lon: c.lon, ts: Date.now() })}
                onClearManual={() => setManualLz(null)}
                onRetry={() => { pendingLzSelRef.current = lzSelId; setScene((s) => (s ? { ...s } : s)) }}
                mode={mapMode} setMode={setMapMode}
              />
            </div>
          )}

          {scene && (
            <div className="card">
              <h2><IconCloud size={14} /> Meteorologia</h2>
              <WeatherPanel wxScene={wxScene} wxBase={wxBase} wxErr={wxErr} metar={metar} daylight={daylight} />
            </div>
          )}

          {scene && (
            <div className="card">
              <h2><IconAlert size={14} /> Alertas de segurança</h2>
              <AlertsPanel alerts={alerts} />
            </div>
          )}

          {scene && (
            <div className="card">
              <h2><IconRoute size={14} /> Acompanhamento da missão</h2>
              <Tracking events={events} onMark={markEvent} onEdit={editEvent} mission={mission} />
            </div>
          )}

          {scene && (
            <div className="card">
              <h2>
                <IconSave size={14} /> Registro
                <span className={'badge ' + (dbId != null ? 'ok' : '')} style={{ marginLeft: 'auto' }}>
                  {dbId != null ? `Salvo · caso #${dbId}` : 'Não salvo'}
                </span>
              </h2>
              <div className="row">
                <button className="btn" onClick={saveCase} disabled={saving}>{saving ? <span className="spin" /> : <IconSave size={14} />} {dbId != null ? 'Atualizar caso' : 'Salvar caso'}</button>
                <button className="btn sec" onClick={() => setShowCases(true)}><IconFolder size={14} /> Casos ({cases.length})</button>
                <button className="btn sec" onClick={copyResumo}><IconCopy size={14} /> Copiar resumo</button>
                <button className="btn sec" onClick={() => window.print()}><IconPrint size={14} /> Imprimir</button>
                <button className="btn sec" onClick={exportJSON}><IconDownload size={14} /> Exportar JSON</button>
              </div>
              {saveFlash && (
                <div className="alert ok" style={{ marginTop: 10, marginBottom: 0 }}>
                  <IconSave size={15} style={{ flex: 'none', marginTop: 1 }} />
                  Caso gravado no servidor. Aparece na lista <b>Casos ({cases.length})</b> — abra para revê-lo depois.{' '}
                  <button className="btn xs sec" style={{ marginLeft: 4 }} onClick={newCase}><IconPlus size={12} /> Iniciar novo caso</button>
                </div>
              )}
              {saveErr && (
                <div className="alert fail" style={{ marginTop: 10, marginBottom: 0 }}>
                  <IconAlert size={15} style={{ flex: 'none', marginTop: 1 }} /> Falha ao salvar no servidor: {saveErr}
                </div>
              )}
              {dbId != null && !saveFlash && (
                <div className="small" style={{ marginTop: 8 }}>
                  Editando um caso já registrado. Alterações usam <b>Atualizar caso</b>; para registrar uma ocorrência diferente, clique em <b>Novo caso</b>.
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="footer">
        <b>SkyRescue β</b> — ferramenta de apoio à decisão em fase piloto. Não substitui o julgamento do médico regulador, os protocolos do SAMU 192 / SESAB, nem a decisão final do comandante da aeronave (GOA/CBMBA). Meteorologia (Open-Meteo) e áreas de pouso (OpenStreetMap) são indicativas e exigem confirmação operacional. Rotas terrestres via OSRM, sem trânsito em tempo real. Não insira dados pessoais de pacientes (LGPD). Os casos são registrados no servidor do GOA com controle de acesso e autoria.
      </div>

      {showCfg && <ConfigModal cfg={cfg} onClose={() => setShowCfg(false)} onSave={(c) => { setCfg(c); saveCfg(c); setShowCfg(false) }} />}

      {showNav && (
        <NavMode
          cfg={cfg} scene={scene} lzPoint={lzPoint}
          hospital={hospital} landingHelipad={landingHelipad}
          onClose={() => setShowNav(false)}
        />
      )}

      {showComm && (
        <CommunityModal
          user={user}
          points={communityLz}
          draft={commDraft}
          onDraftDone={() => setCommDraft(null)}
          onClose={() => { setShowComm(false); setCommDraft(null) }}
          onPickOnMap={() => { setShowComm(false); setMapMode('suggest') }}
          refresh={refreshCommunity}
          onFocus={(p) => { setShowComm(false); setFocus({ lat: p.lat, lon: p.lon, ts: Date.now() }) }}
        />
      )}

      {showCases && (
        <div className="modal-bg" onClick={() => setShowCases(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3><IconFolder size={17} /> Casos registrados (servidor)</h3>
            {casesErr && <div className="login-err">Falha ao carregar casos: {casesErr}</div>}
            {!cases.length && !casesErr && <div className="small">Nenhum caso registrado ainda.</div>}
            {cases.map((c) => (
              <div key={c.id} className="lzrow" style={{ cursor: 'default' }}>
                <div className="lzmain">
                  <div className="n">{c.case_ref || `#${c.id}`} <span className="type">{new Date(c.updated_at).toLocaleString('pt-BR')}</span></div>
                  <div className="m">
                    {c.scene_label || '—'} · score {c.score_total ?? '—'}{c.score_band ? ` (${c.score_band})` : ''}
                    {c.created_by_name || c.created_by_username ? ` · por ${c.created_by_name || c.created_by_username}` : ''}
                  </div>
                </div>
                <button className="btn xs sec" onClick={() => loadCase(c)}>abrir</button>
                <button className="btn xs warn" onClick={() => deleteCase(c)}><IconX size={12} /></button>
              </div>
            ))}
          </div>
        </div>
      )}

      <PrintSheet
        caseId={caseId} scene={scene} sceneLabel={sceneLabel} score={score} gates={gates} rec={rec}
        mission={mission} hospital={hospital} landingHelipad={landingHelipad} lzPoint={lzPoint} manualLz={manualLz} wxScene={wxScene}
        metar={metar} events={events} notes={notes} daylight={daylight} destinoLabel={destinoLabel()}
      />
    </>
  )
}

function PrintSheet({ caseId, scene, sceneLabel, score, gates, rec, mission, hospital, landingHelipad, lzPoint, manualLz, wxScene, metar, events, notes, daylight, destinoLabel }) {
  const hits = Object.values(score.perSection).flatMap((s) => s.hits)
  return (
    <div className="print-sheet">
      <h1>SkyRescue — Registro de avaliação para acionamento aeromédico</h1>
      <div>SAMU 192 Salvador × GOA/CBMBA · {new Date().toLocaleString('pt-BR')} {caseId ? `· Caso ${caseId}` : ''}</div>

      <h2>Ocorrência</h2>
      <table><tbody>
        <tr><th>Local</th><td>{sceneLabel || '—'}</td></tr>
        <tr><th>Coordenadas (DDM)</th><td>{scene ? fmtCoordsDDM(scene) : '—'}</td></tr>
        <tr><th>Coordenadas (dec)</th><td>{scene ? `${fmtCoords(scene)} · ${fmtCoordsDMS(scene)}` : '—'}</td></tr>
      </tbody></table>

      <h2>Pontuação SkyRescue</h2>
      <table><tbody>
        <tr><th>Score</th><td><b>{score.total} pts</b> — {score.band.label}</td></tr>
        <tr><th>Critérios marcados</th><td>{hits.join('; ') || 'nenhum'}</td></tr>
        <tr><th>Recomendação</th><td>{rec ? rec.title : '—'}{!gates.ok ? ` · IMPEDITIVOS: ${gates.fails.map((f) => f.label).join('; ')}` : ''}</td></tr>
      </tbody></table>

      <h2>Tempos estimados</h2>
      <table><tbody>
        <tr><th>Aeromédico (total)</th><td>{fmtMin(mission?.airTotal)}</td></tr>
        <tr><th>Terrestre (total)</th><td>{fmtMin(mission?.ground?.total)}</td></tr>
        <tr><th>Diferença</th><td>{mission?.delta != null ? (mission.delta > 0 ? `aéreo ${fmtMin(mission.delta)} mais rápido` : `terrestre ${fmtMin(-mission.delta)} mais rápido`) : '—'}</td></tr>
        <tr><th>Destino</th><td>{destinoLabel}</td></tr>
        {landingHelipad && <tr><th>Heliponto desemb.</th><td>{landingHelipad.name} · {fmtCoordsDDM(landingHelipad)} <span style={{ color: '#666' }}>(dec {fmtCoords(landingHelipad)})</span></td></tr>}
        <tr><th>LZ</th><td>{lzPoint ? <>{manualLz ? 'Manual' : lzPoint.name} · {fmtCoordsDDM(lzPoint)} <span style={{ color: '#666' }}>(dec {fmtCoords(lzPoint)})</span></> : 'não definida'}</td></tr>
      </tbody></table>

      <h2>Condições</h2>
      <table><tbody>
        <tr><th>Meteorologia (cena)</th><td>{wxScene ? `vento ${Math.round(wxScene.windKmh || 0)} km/h · rajadas ${Math.round(wxScene.gustKmh || 0)} km/h · vis ${wxScene.visM != null ? (wxScene.visM / 1000).toFixed(1) + ' km' : 's/ dado'} · precip ${wxScene.precip ?? '—'} mm/h` : 'sem dados'}</td></tr>
        {metar && <tr><th>METAR SBSV</th><td>{metar}</td></tr>}
        <tr><th>Janela diurna</th><td>{daylight?.note || '—'}</td></tr>
        <tr><th>Gates</th><td>{gates.rows.map((g) => `${g.label}: ${g.effective.toUpperCase()}`).join(' · ')}</td></tr>
      </tbody></table>

      <h2>Cronologia da missão</h2>
      <table><tbody>
        {MILESTONES.map((m) => (
          <tr key={m.id}><th>{m.label}</th><td>{events[m.id] ? new Date(events[m.id]).toLocaleTimeString('pt-BR') : '—'}</td></tr>
        ))}
      </tbody></table>

      {notes && (<><h2>Observações</h2><div>{notes}</div></>)}

      <div style={{ marginTop: 10, fontSize: 10 }}>
        Documento de apoio à decisão gerado pelo SkyRescue β. Estimativas indicativas; decisão final: médico regulador e comandante da aeronave.
      </div>
      <div className="sig">
        <div>Médico Regulador</div>
        <div>Rádio-Operador / TARM</div>
      </div>
    </div>
  )
}
