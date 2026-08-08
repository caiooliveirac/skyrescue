import { useEffect, useMemo, useRef, useState } from 'react'
import { loadCfg, saveCfg, TAG_LABELS, hospitalHelipads, landingPoints } from './config.js'
import { api } from './lib/backend.js'
import { geocode, reverseGeocode, fetchWeather, fetchMetar, groundRoute, overpass, lzQuery, obstacleQuery, heliRadius } from './lib/api.js'
import { catalogNear } from './data/helipads-catalog.js'
import { haversineKm, fmtMin, fmtClock, fmtCoords, fmtCoordsDMS, fmtCoordsDDM, gmapsLink } from './lib/geo.js'
import { computeMission, autoChecks, daylightCheck, rangeCheck, combinedWeatherStatus, classifyWeather } from './lib/mission.js'
import { computeScore, recommendation, evaluateGates, ITEM_BY_ID } from './lib/score.js'
import { rankLZ, parseObstacles } from './lib/lz.js'
import MapView from './components/MapView.jsx'
import NavMode from './components/NavMode.jsx'
import CommunityModal from './components/Community.jsx'
import { LzPhotoModal } from './components/LzPhotos.jsx'
import Checklist from './components/Checklist.jsx'
import PatientForm from './components/PatientForm.jsx'
import Tracking, { MILESTONES, MilestoneQuick } from './components/Tracking.jsx'
import { sendEvent, pendingEvents } from './lib/eventQueue.js'
import { makeDraftSaver, readDraft, draftWorthKeeping } from './lib/draft.js'
import { emptyPatient, readPatient, savePatient, clearPatient, movePatient, migrateLegacyPatient, openProntuario, PATIENT_KEYS, patientWorthKeeping } from './lib/patient.js'
import ConfigModal from './components/ConfigModal.jsx'
import { DecisionStrip, TimePanel, WeatherPanel, LZPanel, AlertsPanel, GatesPanel, CoordReadout } from './components/Results.jsx'
import {
  IconHeli, IconPlus, IconFolder, IconPrint, IconSettings, IconSearch, IconPin,
  IconTarget, IconZap, IconCopy, IconSave, IconDownload, IconHelipadH,
  IconClock, IconCloud, IconAlert, IconRoute, IconX, IconUsers, IconLayers,
} from './components/Icons.jsx'

// Telas do caso. No celular (cabine) o app mostra UMA por vez, escolhida no
// hub de ícones; no desktop da central (>= 1020px) todas aparecem juntas como
// sempre. A "rota" é só o hash da URL — sem router, e o botão voltar do
// Android já sai da tela sem sair do caso.
const VIEWS = ['hub', 'caso', 'fatores', 'navegar', 'nav', 'paciente', 'missao']
// abas do topo quando o celular está dentro de uma tela: trocar de tela é um
// toque, sem passar pelo hub
const VIEW_TABS = [
  ['caso', 'Caso', IconTarget],
  ['fatores', 'Fatores', IconAlert],
  ['navegar', 'Mapa', IconRoute],
  ['paciente', 'Paciente', IconUsers],
  ['missao', 'Missão', IconClock],
]

function useHashView() {
  const read = () => {
    const v = location.hash.slice(1)
    return VIEWS.includes(v) ? v : 'hub'
  }
  const [view, setView] = useState(read)
  useEffect(() => {
    const h = () => setView(read())
    window.addEventListener('hashchange', h)
    return () => window.removeEventListener('hashchange', h)
  }, [])
  return view
}

function useWide() {
  const mq = () => window.matchMedia('(min-width: 1020px)')
  const [wide, setWide] = useState(() => mq().matches)
  useEffect(() => {
    const m = mq()
    // 'change' cobre girar o celular; 'resize' cobre o desktop arrastando a
    // janela (e emuladores que trocam o viewport sem emitir 'change')
    const h = () => setWide(m.matches)
    m.addEventListener('change', h)
    window.addEventListener('resize', h)
    return () => { m.removeEventListener('change', h); window.removeEventListener('resize', h) }
  }, [])
  return wide
}

const go = (v) => { location.hash = v }

export default function App({ user, onLogout }) {
  const [cfg, setCfg] = useState(loadCfg)
  const [showCfg, setShowCfg] = useState(false)
  const [showCases, setShowCases] = useState(false)

  // navegação por tela (celular) x tela única (central)
  const view = useHashView()
  const wide = useWide()
  const show = (v) => wide || view === v

  // ocorrência
  const [scene, setScene] = useState(null)
  const [sceneLabel, setSceneLabel] = useState('')
  const [q, setQ] = useState('')
  const [geoResults, setGeoResults] = useState(null)
  const [geoBusy, setGeoBusy] = useState(false)
  const [caseId, setCaseId] = useState('')
  const [notes, setNotes] = useState('')

  // ficha do paciente (PII) — vive só no cliente, nunca no snapshot do servidor
  const [patient, setPatient] = useState(emptyPatient)
  const updatePatient = (k, v) => setPatient((p) => ({ ...p, [k]: v }))

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
  const [notifying, setNotifying] = useState(false)
  const [notifyMsg, setNotifyMsg] = useState(null) // {ok, text} do acionamento do grupo
  // grupo da missão deste caso: null = nunca acionado, 'ativa', 'encerrada'
  const [missionOpen, setMissionOpen] = useState(null)
  const [saveFlash, setSaveFlash] = useState(false) // confirmação transitória de gravação
  const [saveErr, setSaveErr] = useState('')

  const refreshCases = async () => {
    try { const { cases } = await api.listCases(); setCases(cases); setCasesErr('') }
    catch (e) { setCasesErr(e.message || 'falha ao carregar casos') }
  }
  // a lista se atualiza sozinha: um caso aberto por outro regulador tem que
  // aparecer sem ninguém recarregar a página. Cadência folgada (30 s) — aqui a
  // novidade é "existe um caso novo", não segundos de diferença.
  useEffect(() => {
    const id = setInterval(refreshCases, 30_000)
    const onVis = () => { if (!document.hidden) refreshCases() }
    document.addEventListener('visibilitychange', onVis)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis) }
  }, [])

  // pontos de pouso sugeridos pela comunidade (pendentes + validados)
  const [communityLz, setCommunityLz] = useState([])
  const [showComm, setShowComm] = useState(false)
  // modo navegação do piloto (GPS) virou tela: view === 'nav'
  const [commDraft, setCommDraft] = useState(null) // {lat, lon} clicado no mapa
  // fotos dos pontos de pouso: o ponto tocado no mapa e a contagem por ponto
  // (uma chamada só alimenta o selo de câmera de todos os marcadores)
  const [photoLz, setPhotoLz] = useState(null)
  const [photoCounts, setPhotoCounts] = useState({})
  const refreshPhotoCounts = async () => {
    try { const { counts } = await api.lzPhotoCounts(); setPhotoCounts(counts) }
    catch (e) { /* camada opcional — segue sem os selos */ }
  }
  const communityRef = useRef([]) // leitura na busca de LZ sem refazer o Overpass a cada refresh
  communityRef.current = communityLz
  const refreshCommunity = async () => {
    try { const { points } = await api.listCommunityLz(); setCommunityLz(points) }
    catch (e) { /* camada opcional — segue sem ela */ }
  }
  useEffect(() => { refreshCases(); refreshCommunity(); refreshPhotoCounts() }, [])

  // rastreamento da aeronave: o modo navegação do piloto reporta a posição;
  // aqui a regulação consulta a cada 10 s e mostra o heli no mapa enquanto
  // o dado estiver fresco (<90 s). O rastro é acumulado no cliente.
  const [acft, setAcft] = useState(null)
  const acftTrailRef = useRef([])
  useEffect(() => {
    let alive = true
    const tick = async () => {
      try {
        const { position } = await api.getAircraft()
        if (!alive) return
        const fresh = position && Date.now() - new Date(position.reported_at).getTime() < 90_000
        if (fresh) {
          const t = acftTrailRef.current
          const last = t[t.length - 1]
          if (!last || last[0] !== position.lat || last[1] !== position.lon) t.push([position.lat, position.lon])
          if (t.length > 300) t.shift()
          setAcft({ ...position, trail: [...t] })
        } else {
          acftTrailRef.current = []
          setAcft(null)
        }
      } catch (e) { /* camada opcional */ }
    }
    tick()
    const id = setInterval(tick, 10_000)
    return () => { alive = false; clearInterval(id) }
  }, [])

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

  // Hora de referência da avaliação. Enquanto o caso está sendo avaliado ao
  // vivo acompanha o relógio (tick de 30 s); quando o acionamento é autorizado,
  // ou quando um caso salvo é reaberto, congela na hora do acionamento. É essa
  // hora — não a da impressão — que ancora a janela diurna.
  const [caseRefAt, setCaseRefAt] = useState(null) // hora gravada no caso reaberto
  const refAt = events.decisao ?? caseRefAt // null = avaliação ao vivo
  const [nowTick, setNowTick] = useState(() => Date.now())
  useEffect(() => {
    if (refAt) return
    const id = setInterval(() => setNowTick(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [refAt])
  const refMs = refAt ?? nowTick
  // pôr do sol do dia da avaliação (casos reabertos em outro dia não podem usar
  // o pôr do sol de hoje, que é o que a previsão devolve)
  const [refSunset, setRefSunset] = useState(null)
  const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString()
  const sunsetISO =
    (refSunset && !sameDay(refMs, Date.now()) ? refSunset : null) ||
    wxScene?.sunset || wxBase?.sunset || refSunset

  const daylight = useMemo(
    () =>
      daylightCheck({
        sunsetISO,
        // janela VFR precisa cobrir também o voo de retorno à base
        airTotalMin: mission?.missionEndMin ?? mission?.airTotal,
        nightAllowed: cfg.ops.nightAllowed,
        marginMin: cfg.ops.sunsetMarginMin,
        refMs,
      }),
    [sunsetISO, mission, cfg.ops.nightAllowed, cfg.ops.sunsetMarginMin, refMs]
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

  // horário marcado/ajustado vai direto ao servidor (e ao grupo, se a missão
  // foi acionada) — sem esperar o "Atualizar caso". Debounce: o input de hora
  // dispara onChange a cada tecla e mandaria "(corrigido)" repetido ao grupo.
  // Se estiver sem sinal (comum em voo), o horário entra numa fila local e é
  // reenviado quando a conexão voltar — ver lib/eventQueue.js.
  const evtTimersRef = useRef({})
  // marcar "Acionamento do GOA autorizado" ACIONA o grupo no servidor (o médico
  // não precisa clicar "Grupo da missão" também). A resposta diz se o bot
  // conseguiu falar — sem isso ele não teria como saber que o grupo ficou mudo.
  const onEventSaved = (r) => {
    if (r?.mission === 'aberta') {
      setMissionOpen('ativa')
      setNotifyMsg({ ok: true, text: 'Acionamento autorizado — briefing enviado ao grupo da missão.' })
    } else if (r?.mission === 'erro') {
      setNotifyMsg({ ok: false, text: `Horário gravado, mas o grupo NÃO foi acionado: ${r.missionError || 'falha no Telegram'}` })
    }
  }
  const pushEvent = (id, ts, delay = 1200) => {
    if (dbId == null) return // caso ainda não salvo: fica só local, como antes
    clearTimeout(evtTimersRef.current[id])
    // a entrada SAI do mapa ao disparar: enquanto ela existe, o poll de tempo
    // real não toca neste marco. Se ficasse para trás, a tela nunca mais
    // aceitaria a correção do horário feita em outra tela.
    evtTimersRef.current[id] = setTimeout(() => {
      delete evtTimersRef.current[id]
      sendEvent(dbId, id, ts, onEventSaved)
    }, delay)
  }
  const markEvent = (id) => {
    const ts = Date.now()
    setEvents((p) => ({ ...p, [id]: ts }))
    pushEvent(id, ts)
  }
  // marcação rápida (um toque): segura o envio até a janela de "desfazer"
  // fechar, para um toque acidental não ecoar no grupo do Telegram
  const quickMarkEvent = (id, ts) => {
    setEvents((p) => ({ ...p, [id]: ts }))
    pushEvent(id, ts, 6500)
  }
  const undoEvent = (id) => {
    clearTimeout(evtTimersRef.current[id])
    delete evtTimersRef.current[id]
    setEvents((p) => { const n = { ...p }; delete n[id]; return n })
  }
  const editEvent = (id, hhmm) => {
    if (!hhmm) return // campo limpo durante a edição — mantém o horário anterior
    const [h, m] = hhmm.split(':').map(Number)
    if (!Number.isFinite(h) || !Number.isFinite(m)) return
    const d = new Date(); d.setHours(h, m, 0, 0)
    setEvents((p) => ({ ...p, [id]: d.getTime() }))
    pushEvent(id, d.getTime())
  }

  // ---------- a ocorrência ao vivo, em todas as telas ----------
  // A mesma ocorrência é acompanhada em vários lugares ao mesmo tempo: a
  // regulação no PC, o médico no celular, o piloto no modo navegação. Quando um
  // toca "Decolagem da base", tem que aparecer nas outras telas — sem F5, e não
  // só no grupo do Telegram.
  //
  // Poll de 5 s do estado mínimo do caso, mesma escolha do rastreamento:
  // atravessa Cloudflare/nginx e rede de celular sem manutenção, e nesta
  // cadência (marcos separados por minutos) ninguém percebe diferença para SSE.
  const eventsRef = useRef(events)
  useEffect(() => { eventsRef.current = events }, [events])
  const sinceRef = useRef(null)      // updated_at da última resposta desta tela
  const baseRef = useRef(null)       // último snapshot VINDO do servidor
  const [liveMsg, setLiveMsg] = useState(null)   // o que chegou de outra tela

  // Campos que uma PESSOA edita: os únicos que sincronizam e os únicos que
  // disparam gravação. Os derivados (score, tempos, lzPoint, recomendação) cada
  // tela recalcula da SUA Config — que é local do navegador. Se eles entrassem
  // na comparação, duas telas com Config diferente se regravariam em ping-pong
  // para sempre. Eles vão junto na gravação; só não mandam nela.
  const CAMPOS_VIVOS = [
    'id', 'scene', 'sceneLabel', 'notes', 'hospitalId', 'landingSel', 'ambEta',
    'manualChecked', 'autoOverrides', 'gateManual', 'gateOverrides', 'lzSelId', 'manualLz',
  ]
  // calculados por cada tela a partir da SUA Config; viajam junto na gravação
  // (alimentam a lista de casos e o relatório) mas nunca disparam gravação
  const DERIVADOS = ['ts', 'hospitalName', 'lzPoint', 'landingName', 'scoreTotal',
    'band', 'recommendation', 'gatesOk', 'mission']
  const mesmo = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
  // assinatura do que é AUTORAL no caso — muda => há o que gravar
  const assinaturaViva = (s) =>
    JSON.stringify([...CAMPOS_VIVOS.map((k) => s?.[k] ?? null), s?.events ?? null])

  // aplica no formulário um campo que veio de outra tela
  const SETTERS = {
    id: setCaseId, scene: setScene, sceneLabel: setSceneLabel, notes: setNotes,
    hospitalId: setHospitalId, landingSel: setLandingSel, ambEta: setAmbEta,
    manualChecked: setManualChecked, autoOverrides: setAutoOverrides,
    gateManual: setGateManual, gateOverrides: setGateOverrides,
    lzSelId: setLzSelId, manualLz: setManualLz,
  }
  const ROTULOS = {
    id: 'identificador', scene: 'local da ocorrência', sceneLabel: 'local da ocorrência',
    notes: 'observações', hospitalId: 'hospital de destino', landingSel: 'ponto de desembarque',
    ambEta: 'tempo da ambulância', manualChecked: 'pontuação', autoOverrides: 'pontuação',
    gateManual: 'condições operacionais', gateOverrides: 'condições operacionais',
    lzSelId: 'LZ escolhida', manualLz: 'LZ escolhida',
  }
  // vazio de cada campo: input controlado do React não aceita null
  const VAZIO = {
    id: '', sceneLabel: '', notes: '', ambEta: '', landingSel: 'auto',
    hospitalId: cfg.hospitals[0]?.id || '', scene: null, lzSelId: null, manualLz: null,
    manualChecked: {}, autoOverrides: {}, gateManual: {}, gateOverrides: {},
  }
  const clientIdRef = useRef(Math.random().toString(36).slice(2, 10) + Date.now().toString(36))
  const ultimoSalvoRef = useRef(null)   // assinatura viva que já está no servidor
  const enviandoRef = useRef(new Set()) // campos com gravação nossa em voo
  const [autoSave, setAutoSave] = useState(null) // {at} | {err}

  // aba oculta consulta MENOS, nunca "nada": kiosk, webview e painel embutido
  // mentem no document.hidden (alguns dizem oculto com a tela na frente), e uma
  // tela de regulação muda por causa disso é justamente o defeito a evitar
  const LIVE_MS = 5000
  const LIVE_MS_OCULTA = 30_000
  useEffect(() => {
    if (dbId == null) return
    let alive = true
    let ultimo = 0
    const tick = async (forcar) => {
      const espera = document.hidden ? LIVE_MS_OCULTA : LIVE_MS
      if (!forcar && Date.now() - ultimo < espera - 500) return
      ultimo = Date.now()
      try {
        const r = await api.liveCase(dbId, sinceRef.current)
        if (!alive) return
        setMissionOpen(r.missionStatus || null)

        // ---- ficha do paciente ----
        // No poll viaja só o carimbo de tempo (PII não entra numa resposta que
        // se repete a cada 5 s). Mudou lá => busca a ficha. Precisa vir ANTES
        // do `unchanged`: a ficha muda sem tocar em cases.updated_at, e no
        // caminho curto ela ficaria invisível para sempre.
        if (r.patientAt && r.patientAt !== patientAtRef.current) {
          puxarFicha(dbId)
            .then((base) => { if (base && alive) setLiveMsg({ quais: 'ficha do paciente', by: r.updatedBy }) })
        }

        if (r.unchanged) return
        sinceRef.current = r.updatedAt
        const remoto = r.snapshot || {}
        const base = baseRef.current
        baseRef.current = remoto
        const chamou = []

        // ---- marcos ----
        // um marco que esta tela acabou de tocar (POST em voo, fila offline ou
        // debounce aberto) é MAIS novo que o servidor — nunca sobrescrever
        const pend = pendingEvents(dbId)
        const prevEv = eventsRef.current
        const chegaram = Object.entries(remoto.events || {}).filter(
          ([id, ts]) => ts && !pend.has(id) && !evtTimersRef.current[id] && prevEv[id] !== ts
        )
        if (chegaram.length) {
          eventsRef.current = { ...prevEv, ...Object.fromEntries(chegaram) }
          setEvents((p) => ({ ...p, ...Object.fromEntries(chegaram) }))
          chamou.push(...chegaram.map(([id, ts]) =>
            `${MILESTONES.find((m) => m.id === id)?.label || id} ${fmtClock(ts)}`))
        }

        // ---- o resto do caso ----
        // Campo a campo, comparando com o último estado VINDO DO SERVIDOR (não
        // com o nosso): assim uma alteração remota no destino não desfaz a
        // marcação que este operador está fazendo no checklist, e a nossa
        // própria gravação, já refletida na base, não se reaplica.
        //
        // O que NÃO fazer (e eu fiz): descartar a resposta inteira quando o
        // último a gravar fomos nós. A mesma resposta carrega o que as OUTRAS
        // telas gravaram antes — com duas pessoas editando ao mesmo tempo, cada
        // tela via a si própria como última gravadora e engolia a mudança da
        // outra em silêncio, ficando parada para sempre.
        if (base) {
          const tocados = []
          for (const k of CAMPOS_VIVOS) {
            if (enviandoRef.current.has(k)) continue // nossa gravação em voo
            if (mesmo(remoto[k], base[k])) continue
            SETTERS[k]?.(remoto[k] ?? VAZIO[k])
            tocados.push(ROTULOS[k] || k)
          }
          if (tocados.length) chamou.push(...[...new Set(tocados)])
        }

        if (chamou.length) {
          // o que veio de fora já está na tela; a assinatura passa a ser a do
          // servidor para a gravação automática não devolver o mesmo conteúdo
          ultimoSalvoRef.current = assinaturaViva(remoto)
          setLiveMsg({ quais: chamou.join(' · '), by: r.updatedBy })
        }
      } catch (e) { /* camada opcional: sem rede a tela segue com o que tem */ }
    }
    tick(true)
    const id = setInterval(tick, LIVE_MS)
    // voltar para a aba tem que mostrar o estado de agora, não o de 30 s atrás
    const onVis = () => { if (!document.hidden) tick(true) }
    document.addEventListener('visibilitychange', onVis)
    return () => { alive = false; clearInterval(id); document.removeEventListener('visibilitychange', onVis) }
  }, [dbId])

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
    // hora de referência da avaliação + pôr do sol daquele dia: sem isso, ao
    // reabrir/reimprimir o caso a janela diurna seria recalculada com a hora
    // atual e um caso viável apareceria como inviável
    refAt: refMs,
    sunsetISO: sunsetISO || null,
    scene, sceneLabel, hospitalId, hospitalName: hospital?.name || null, landingSel, ambEta, notes,
    manualChecked, autoOverrides, gateManual, gateOverrides,
    lzSelId, manualLz, events,
    // ponto de encontro nomeado p/ o bot da missão (lzSelId sozinho não
    // resolve fora do app: o candidato vem do Overpass e não fica no snapshot)
    lzPoint: lzPoint ? { name: manualLz ? 'LZ manual' : lzPoint.name || 'LZ', lat: lzPoint.lat, lon: lzPoint.lon } : null,
    landingName: landingHelipad?.name || null,
    scoreTotal: score.total, band: score.band.key,
    recommendation: rec?.title || null, gatesOk: gates.ok,
    mission: mission ? { airTotal: mission.airTotal, groundTotal: mission.ground.total, delta: mission.delta } : null,
  })

  // ---------- rascunho local ----------
  // No plantão o caso é abandonado no meio o tempo todo (tablet dorme, aba
  // fechada, bateria acaba) e ninguém clica em "Salvar" antes. Todo o estado
  // do caso é espelhado no localStorage a cada mudança e regravado na hora em
  // que a aba some, então reabrir devolve o que estava escrito sem depender
  // de botão nenhum. Ver src/lib/draft.js.
  const draft = useMemo(() => makeDraftSaver(user?.id), [user?.id])
  useEffect(() => () => draft.dispose(), [draft])

  // A RECUPERAÇÃO VEM PRIMEIRO, e não é só questão de gosto: os efeitos rodam
  // na ordem em que são declarados, então um autosave declarado antes rodaria
  // no boot com o estado ainda vazio e apagaria o rascunho que ele deveria
  // restaurar. `booted` também segura o autosave até a tentativa terminar.
  // applySnapshot/newCase são recriados a cada render e ficam definidos mais
  // abaixo; o ref os mantém fora das dependências, para o efeito rodar UMA vez
  // e nunca sobrescrever o que o usuário já digitou depois.
  const lateRef = useRef({})
  const booted = useRef(false)
  const [restored, setRestored] = useState(null) // {at} do rascunho recuperado

  // ficha do paciente guardada para AQUELE caso, com o médico regulador
  // pré-preenchido com quem está logado (se a ficha ainda não disser outro)
  const patientFor = (id) => {
    const p = readPatient(user?.id, id) || emptyPatient()
    if (!p.medico && user?.full_name) p.medico = user.full_name
    return p
  }

  useEffect(() => {
    migrateLegacyPatient(user?.id) // ficha da v1 (sem caso) vira ficha do rascunho
    const d = readDraft(user?.id)
    if (d) {
      // applySnapshot já traz a ficha do caso que está sendo restaurado
      lateRef.current.applySnapshot?.(d.snapshot, d.dbId)
      setRestored({ at: d.at })
    } else {
      setPatient(patientFor(null))
    }
    booted.current = true
  }, [user?.id])

  // espelha a ficha no localStorage, na gaveta DO CASO aberto; grava na hora
  // que a aba some, igual ao rascunho. Isto é o espelho offline — a fonte da
  // verdade é o servidor (ver o autosave da ficha, mais abaixo). `dbId` entra
  // nas dependências: trocar de caso troca de gaveta.
  useEffect(() => {
    if (!booted.current) return
    savePatient(user?.id, dbId, patient)
  }, [patient, user?.id, dbId])
  useEffect(() => {
    const flush = () => { if (booted.current) savePatient(user?.id, dbId, patient) }
    const onHide = () => { if (document.visibilityState === 'hidden') flush() }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', flush)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', flush)
    }
  }, [patient, user?.id, dbId])

  // ---------- ficha do paciente no servidor ----------
  // Mesma mecânica do caso: grava só o que ESTA tela mudou, contra o último
  // estado vindo do servidor. Duas pessoas na mesma ocorrência escrevem em
  // campos diferentes da ficha (a médica a hipótese, a regulação os vitais) e
  // nenhuma pode apagar o campo da outra.
  const basePatientRef = useRef(null)      // última ficha VINDA do servidor
  const enviandoPatientRef = useRef(new Set()) // campos com PATCH nosso em voo
  // espelho do estado para o poll: o efeito que consulta o servidor é criado
  // uma vez por caso e enxergaria uma ficha velha se lesse a closure (mesmo
  // motivo do eventsRef, mais acima)
  const patientRef = useRef(patient)
  useEffect(() => { patientRef.current = patient }, [patient])
  const patientAtRef = useRef(null)        // updated_at da ficha já aplicada
  const [patientSync, setPatientSync] = useState(null) // {at} | {err}
  // Ficha que veio do espelho local para um caso que o servidor não tem ficha:
  // pode ter sido escrita ANTES desta mudança, quando a tela prometia que o
  // dado não sairia do navegador. Fica retida — nada sobe sem o usuário mandar.
  // Não confundir com ficha nova: essa grava sozinha, como todo o resto do caso.
  const [fichaPendente, setFichaPendente] = useState(false)

  // Traz a ficha do servidor para a tela, campo a campo.
  //
  // O que NÃO pode ser sobrescrito é o que esta tela tem de DIFERENTE do último
  // estado que veio do servidor: isso é edição local ainda não gravada. Só o
  // foco não serve de critério — bastaria alguém deixar o cursor parado num
  // campo para ele devolver o valor velho por cima do que o colega escreveu.
  // Quem não digitou nada não tem o que perder, e numa ocorrência ao vivo é
  // melhor ver o valor novo da equipe.
  const puxarFicha = async (id) => {
    try {
      const r = await api.getPatient(id)
      const remoto = r.patient || null
      patientAtRef.current = r.updatedAt || null
      if (!remoto) {
        // servidor ainda não tem ficha deste caso: o espelho local (se houver)
        // continua valendo e vira candidato a subir — ver `fichaSoLocal`
        basePatientRef.current = null
        return null
      }
      const anterior = basePatientRef.current
      const atual = patientRef.current
      const base = { ...emptyPatient(), ...remoto }
      const novo = { ...atual }
      for (const k of PATIENT_KEYS) {
        if (enviandoPatientRef.current.has(k)) continue // gravação nossa em voo
        // edição local ainda não gravada vence e será enviada pelo autosave; a
        // base fica com o valor LOCAL para não virar diferença fantasma, que
        // reenviaria o campo a cada resposta do servidor
        if (anterior && String(atual[k] ?? '') !== String(anterior[k] ?? '')) {
          base[k] = atual[k] ?? ''
          continue
        }
        novo[k] = base[k] ?? ''
      }
      if (!novo.medico && user?.full_name) novo.medico = user.full_name
      basePatientRef.current = base
      setFichaPendente(false) // o servidor tem ficha: ela manda, nada a consentir
      setPatient(novo)
      setPatientSync({ at: Date.now() })
      return base
    } catch (e) {
      // sem rede a tela segue com o espelho local. Não precisa reagendar: como
      // `patientAtRef` continua no valor antigo, o próximo poll que der certo
      // vê o carimbo diferente e busca de novo sozinho.
      setPatientSync({ err: e.message || String(e) })
      return null
    }
  }

  // Sobe a ficha inteira de uma vez. Usado quando o caso acaba de nascer no
  // servidor e quando o usuário manda subir uma ficha que só existia local.
  const subirFicha = async (id, p) => {
    const campos = {}
    for (const k of PATIENT_KEYS) if (String(p?.[k] || '').trim() !== '') campos[k] = p[k]
    if (!Object.keys(campos).length) return
    const r = await api.patchPatient(id, campos, clientIdRef.current)
    basePatientRef.current = { ...emptyPatient(), ...campos }
    patientAtRef.current = r?.updatedAt || patientAtRef.current
    setFichaPendente(false)
    setPatientSync({ at: Date.now() })
  }

  // Reenvio depois de falha. Sem isto, a gravação só seria retentada na tecla
  // SEGUINTE — e o caso típico a bordo é justamente digitar, perder o sinal e
  // parar de digitar: o texto ficaria só no tablet, que é exatamente o defeito
  // que esta mudança existe para eliminar. Volta a tentar sozinho, e na hora em
  // que o sistema avisa que a rede voltou.
  const [retryFicha, setRetryFicha] = useState(0)
  const retryFichaRef = useRef(null)
  const reagendarFicha = () => {
    if (retryFichaRef.current) return // já há uma tentativa marcada
    retryFichaRef.current = setTimeout(() => {
      retryFichaRef.current = null
      setRetryFicha((n) => n + 1)
    }, 15000)
  }
  useEffect(() => {
    const agora = () => {
      clearTimeout(retryFichaRef.current); retryFichaRef.current = null
      setRetryFicha((n) => n + 1)
    }
    window.addEventListener('online', agora)
    return () => {
      window.removeEventListener('online', agora)
      clearTimeout(retryFichaRef.current); retryFichaRef.current = null
    }
  }, [])

  // gravação automática da ficha: 1,5 s depois da última tecla, só os campos
  // alterados em relação ao servidor
  const patientSig = JSON.stringify(PATIENT_KEYS.map((k) => patient?.[k] ?? ''))
  useEffect(() => {
    if (dbId == null || !booted.current) return
    if (fichaPendente) return // ficha retida esperando o "enviar" do usuário
    // servidor sem ficha ainda: a comparação é contra o vazio, e o primeiro
    // campo digitado cria a ficha lá — é o caminho normal de quem preenche
    const base = basePatientRef.current || emptyPatient()
    const alterados = {}
    for (const k of PATIENT_KEYS) {
      if (String(patient[k] ?? '') !== String(base[k] ?? '')) alterados[k] = patient[k] ?? ''
    }
    if (!Object.keys(alterados).length) return
    const t = setTimeout(async () => {
      const emVoo = Object.keys(alterados)
      emVoo.forEach((k) => enviandoPatientRef.current.add(k))
      try {
        const r = await api.patchPatient(dbId, alterados, clientIdRef.current)
        basePatientRef.current = { ...(basePatientRef.current || emptyPatient()), ...alterados }
        patientAtRef.current = r?.updatedAt || patientAtRef.current
        setPatientSync({ at: Date.now() })
      } catch (e) {
        // o espelho local já guardou; volta a tentar sozinho, sem depender de
        // a pessoa digitar de novo
        setPatientSync({ err: e.message || String(e) })
        reagendarFicha()
      } finally {
        emVoo.forEach((k) => enviandoPatientRef.current.delete(k))
      }
    }, 1500)
    return () => clearTimeout(t)
  }, [patientSig, dbId, fichaPendente, retryFicha])

  const fichaSoLocal = fichaPendente && patientWorthKeeping(patient)
  const [enviandoFicha, setEnviandoFicha] = useState(false)
  // Subir é ATO EXPLÍCITO, nunca automático: estas fichas foram digitadas sob
  // um aviso na tela de que nunca sairiam do navegador. Quem escreveu decide.
  const enviarFichaLocal = async () => {
    if (dbId == null || enviandoFicha) return
    setEnviandoFicha(true)
    try {
      await subirFicha(dbId, patient)
    } catch (e) {
      setPatientSync({ err: e.message || String(e) })
    } finally {
      setEnviandoFicha(false)
    }
  }

  // assinatura do que compõe o caso: muda => reagenda a gravação do rascunho
  const draftSig = JSON.stringify([
    caseId, scene, sceneLabel, notes, hospitalId, landingSel, ambEta,
    manualChecked, autoOverrides, gateManual, gateOverrides,
    lzSelId, manualLz, events, dbId,
  ])
  useEffect(() => {
    if (!booted.current) return
    const snap = snapshot()
    if (draftWorthKeeping(snap)) draft.schedule({ snapshot: snap, dbId })
    else draft.clear() // caso vazio (recém-aberto ou "Novo caso") não vira rascunho
  }, [draftSig, draft])

  const discardDraft = () => { draft.clear(); setRestored(null); lateRef.current.newCase?.() }

  // ---------- gravação automática ----------
  // Depois que o caso existe no servidor, ninguém mais precisa clicar
  // "Atualizar caso": a ocorrência é acompanhada em várias telas ao mesmo tempo
  // e o que uma pessoa marca só serve para as outras se chegar lá sozinho.
  // Grava 1,5 s depois da última mudança AUTORAL (assinatura viva) — o que a
  // tela recalcula sozinha não conta, senão gravaria a cada tique do relógio.
  // A auditoria é coalescida no servidor (uma linha por usuário a cada 5 min).
  useEffect(() => {
    if (dbId == null || !booted.current) return
    const snap = snapshot()
    const sig = assinaturaViva(snap)
    if (sig === ultimoSalvoRef.current) return
    const t = setTimeout(async () => {
      const base = baseRef.current || {}
      // só o que ESTA tela mudou em relação ao que o servidor tem. Mandar o
      // snapshot inteiro apagaria o campo que a outra tela acabou de escrever.
      const alterados = {}
      for (const k of CAMPOS_VIVOS) if (!mesmo(snap[k], base[k])) alterados[k] = snap[k] ?? null
      if (!Object.keys(alterados).length) { ultimoSalvoRef.current = sig; return }
      // os derivados (score, tempos, destino por extenso) acompanham: são o que
      // alimenta a lista de casos e o relatório, e cada tela os recalcula ao abrir
      for (const k of DERIVADOS) alterados[k] = snap[k] ?? null
      const anterior = ultimoSalvoRef.current
      ultimoSalvoRef.current = sig
      const emVoo = Object.keys(alterados)
      emVoo.forEach((k) => enviandoRef.current.add(k))
      try {
        await api.patchCase(dbId, alterados, clientIdRef.current)
        // a base passa a conter o que gravamos — o poll não reaplica isto como
        // novidade. O updated_at NÃO é adotado: a mesma linha pode ter mudanças
        // de outras telas que ainda não vimos.
        baseRef.current = { ...baseRef.current, ...alterados }
        setAutoSave({ at: Date.now() })
      } catch (e) {
        // volta a assinatura: a próxima mudança tenta de novo, e o rascunho
        // local já guardou tudo de qualquer forma
        ultimoSalvoRef.current = anterior
        setAutoSave({ err: e.message || String(e) })
      } finally {
        emVoo.forEach((k) => enviandoRef.current.delete(k))
      }
    }, 1500)
    return () => clearTimeout(t)
  }, [draftSig, dbId])

  // grava no servidor (Postgres). dbId != null => atualiza o mesmo caso.
  const saveCase = async () => {
    if (saving) return
    setSaving(true)
    setSaveErr('')
    const snap = snapshot()
    if (!caseId) setCaseId(snap.id)
    try {
      if (dbId != null) {
        await api.updateCase(dbId, snap, { clientId: clientIdRef.current })
      } else {
        const { id } = await api.createCase(snap, clientIdRef.current)
        // a ficha digitada antes do caso existir no servidor vai junto: no
        // espelho local (muda de gaveta) e no servidor, que passa a ser a
        // fonte da verdade dela a partir daqui
        movePatient(user?.id, null, id)
        await subirFicha(id, patient).catch((e) => console.warn('ficha não subiu:', e?.message || e))
        setDbId(id)
      }
      // a base absorve o que gravamos (o poll não reaplica isto como novidade).
      // O `since` NÃO avança com gravação nossa: a mesma linha pode carregar
      // mudança de outra tela que ainda não vimos, e a resposta curta
      // ("unchanged") a esconderia para sempre.
      sinceRef.current = null
      ultimoSalvoRef.current = assinaturaViva(snap)
      baseRef.current = snap
      setAutoSave({ at: Date.now() })
      await refreshCases()
      setSaveFlash(true)
      setTimeout(() => setSaveFlash(false), 4000)
    } catch (e) {
      setSaveErr(e.message || String(e))
    } finally {
      setSaving(false)
    }
  }

  // aciona o grupo da missão no Telegram (briefing + orientações do bot).
  // Salva/atualiza antes: o bot lê o snapshot do servidor.
  const notifyGroup = async () => {
    if (notifying || saving) return
    setNotifying(true)
    setNotifyMsg(null)
    try {
      const snap = snapshot()
      if (!caseId) setCaseId(snap.id)
      let id = dbId
      if (id != null) {
        await api.updateCase(id, snap, { clientId: clientIdRef.current })
      } else {
        const r = await api.createCase(snap, clientIdRef.current)
        id = r.id
        movePatient(user?.id, null, id) // ver saveCase
        await subirFicha(id, patient).catch((e) => console.warn('ficha não subiu:', e?.message || e))
        setDbId(id)
        await refreshCases()
      }
      sinceRef.current = null
      ultimoSalvoRef.current = assinaturaViva(snap)
      baseRef.current = snap
      await api.notifyCase(id)
      setMissionOpen('ativa')
      setNotifyMsg({ ok: true, text: 'Briefing enviado ao grupo da missão.' })
    } catch (e) {
      setNotifyMsg({ ok: false, text: e.message || String(e) })
    } finally {
      setNotifying(false)
    }
  }

  // restaura o estado do app a partir de um snapshot (banco ou rascunho local)
  // `mission` é o status do grupo da missão vindo do servidor ('ativa' |
  // 'encerrada' | null); o rascunho local não sabe e assume nunca acionado
  const applySnapshot = (c, id, mission = null) => {
    revGeoRef.current++
    pendingLzSelRef.current = c.scene ? c.lzSelId || null : null
    setDbId(id ?? null)
    setMissionOpen(mission)
    setNotifyMsg(null)
    // o poll ao vivo recomeça do zero para o caso que está entrando: o que
    // acabou de ser carregado JÁ é o estado do servidor, não é novidade de fora
    // e não precisa ser regravado
    sinceRef.current = null; setLiveMsg(null); setAutoSave(null)
    baseRef.current = c; ultimoSalvoRef.current = assinaturaViva(c)
    setCaseId(c.id || ''); setSceneLabel(c.sceneLabel || ''); setScene(c.scene)
    const hospOk = cfg.hospitals.some((h) => h.id === c.hospitalId)
    setHospitalId(hospOk ? c.hospitalId : cfg.hospitals[0]?.id || '')
    setLandingSel(c.landingSel || 'auto'); setAmbEta(c.ambEta || ''); setNotes(c.notes || '')
    setManualChecked(c.manualChecked || {}); setAutoOverrides(c.autoOverrides || {})
    setGateManual(c.gateManual || {}); setGateOverrides(c.gateOverrides || {})
    setLzSelId(c.lzSelId || null); setManualLz(c.manualLz || null); setEvents(c.events || {})
    // congela a avaliação na hora original do caso (casos antigos, sem refAt,
    // caem no ts da gravação)
    setCaseRefAt(c.refAt || c.ts || null); setRefSunset(c.sunsetISO || null)
    // Ficha do paciente: o espelho local entra na hora (a tela não fica em
    // branco esperando a rede) e o servidor, que é a fonte da verdade, chega
    // logo atrás e vence quando tem conteúdo. Caso sem ficha em lugar nenhum
    // abre em branco — nunca com o paciente do caso anterior.
    const fichaLocal = patientFor(id ?? null)
    setPatient(fichaLocal)
    basePatientRef.current = null
    patientAtRef.current = null
    enviandoPatientRef.current.clear()
    setPatientSync(null)
    // retém o que veio do espelho até o servidor responder: se ele já tem
    // ficha, ela vence; se não tem, subir é decisão do usuário
    setFichaPendente(id != null && patientWorthKeeping(fichaLocal))
    if (id != null) puxarFicha(id)
    setSaveFlash(false); setSaveErr('')
  }

  // carrega o snapshot completo do banco e restaura o estado do app
  const loadCase = async (row) => {
    try {
      const { case: full } = await api.getCase(row.id)
      applySnapshot(full.snapshot || {}, row.id, full.mission_status || null)
      setRestored(null)
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

  // Prontuário exportável: leva o contexto operacional JÁ calculado (score,
  // tempos, destino, cronologia) para o médico não redigitar; a PII vem da
  // ficha (patient) e não passa pelo servidor.
  const exportProntuario = () => {
    const hits = Object.values(score.perSection).flatMap((s) => s.hits)
    const air = mission?.airTotal, gnd = mission?.ground?.total
    const ctx = {
      caseId,
      sceneLabel: sceneLabel || '',
      sceneCoords: scene ? `${fmtCoordsDDM(scene)} (dec ${fmtCoords(scene)})` : '',
      destino: hospital ? destinoLabel() : '',
      meio: rec ? (rec.key === 'blocked' ? 'Terrestre (aéreo inviável no momento)' : rec.key === 'green' ? 'Transporte terrestre' : 'Aeromédico (helicóptero)') : '',
      justificativa: `Score SkyRescue ${score.total} pts — ${score.band.label}${gates.ok ? '' : ' · IMPEDITIVOS: ' + gates.fails.map((f) => f.label).join('; ')}`,
      criterios: hits.join('; '),
      tempos: air != null ? `Aéreo ${fmtMin(air)}${gnd != null ? ` · Terrestre ${fmtMin(gnd)}${mission.delta != null ? ` (Δ ${fmtMin(Math.abs(mission.delta))})` : ''}` : ''}` : '',
      lz: lzPoint ? `${manualLz ? 'Manual' : lzPoint.name} — ${fmtCoordsDDM(lzPoint)}` : '',
      cronologia: MILESTONES.map((m) => ({ label: m.label, time: events[m.id] ? new Date(events[m.id]).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '' })),
      medico: user?.full_name || '',
    }
    openProntuario(patient, ctx)
  }

  const newCase = () => {
    revGeoRef.current++
    draft.clear(); setRestored(null)
    // some só a ficha do rascunho em curso; as fichas dos casos já gravados
    // continuam nas gavetas deles (e no servidor)
    clearPatient(user?.id, null)
    setPatient(patientFor(null))
    basePatientRef.current = null; patientAtRef.current = null
    enviandoPatientRef.current.clear(); setPatientSync(null); setFichaPendente(false)
    setDbId(null); setSaveFlash(false); setSaveErr('')
    setMissionOpen(null); setNotifyMsg(null)
    sinceRef.current = null; baseRef.current = null; ultimoSalvoRef.current = null
    setLiveMsg(null); setAutoSave(null)
    setScene(null); setSceneLabel(''); setQ(''); setCaseId(''); setNotes(''); setGeoResults(null)
    setManualChecked({}); setAutoOverrides({}); setGateManual({}); setGateOverrides({})
    setAmbEta(''); setLzSelId(null); setManualLz(null); setEvents({}); setLandingSel('auto')
    setCaseRefAt(null); setRefSunset(null); setNowTick(Date.now())
    setHospitalId(cfg.hospitals[0]?.id || '')
    setWxScene(null); setWxBase(null); setMetar(null); setLzList(null); setObstacles(null); setRoute(null)
  }

  // publica para o efeito de recuperação (declarado antes destas funções)
  lateRef.current.applySnapshot = applySnapshot
  lateRef.current.newCase = newCase

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
        <button className="tbtn" onClick={newCase} title="Novo caso"><IconPlus size={14} /> <span className="tlabel">Novo caso</span></button>
        <button className="tbtn" onClick={() => setShowCases(true)} title={`Casos registrados (${cases.length})`}>
          <IconFolder size={14} /> <span className="tlabel">Casos ({cases.length})</span>
        </button>
        <button className="tbtn" onClick={() => window.print()} title="Imprimir registro do caso">
          <IconPrint size={14} /> <span className="tlabel">Registro</span>
        </button>
        <button className="tbtn" onClick={() => setShowCfg(true)} title="Configuração"><IconSettings size={14} /> <span className="tlabel">Config</span></button>
        {user && <span className="who" title={user.role}>{user.full_name || user.username}</span>}
        <button className="tbtn" onClick={doLogout} title="Encerrar sessão"><IconX size={14} /> <span className="tlabel">Sair</span></button>
      </div>

      {/* faixa de decisão só na central: no celular o score já está no hub e no
          card "Pontuação de elegibilidade", e a faixa custava uma tela inteira */}
      {wide && <DecisionStrip scene={scene} score={score} gates={gates} rec={rec} onCopy={copyResumo} />}

      {restored && (
        <div className="notice notice-draft">
          <b>Rascunho recuperado</b> — o caso voltou como estava às{' '}
          {new Date(restored.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}.
          {dbId != null ? ' Já existe no servidor; use "Atualizar caso" para gravar as mudanças.' : ' Ainda não foi gravado no servidor.'}
          <button className="tbtn" onClick={discardDraft} style={{ marginLeft: 10 }}>Descartar e começar novo</button>
        </div>
      )}

      {!wide && view === 'hub' && (
        <div className="hub">
          <button className="tile" onClick={() => go('caso')}>
            <IconTarget size={38} />
            <span className="t">Caso</span>
            <span className="d">local · pontuação · destino</span>
            <span className={'badge ' + (score.total >= 9 ? 'fail' : score.total >= 5 ? 'warn' : score.total > 0 ? 'ok' : '')}>
              {score.total} pts{rec ? ` · ${score.band.label}` : ''}
            </span>
          </button>

          <button className="tile" onClick={() => go('fatores')}>
            <IconAlert size={38} />
            <span className="t">Fatores</span>
            <span className="d">gates · meteo · tempos · LZ</span>
            <span className={'badge ' + (gates.fails.length ? 'fail' : gates.warns.length ? 'warn' : 'ok')}>
              {gates.fails.length ? `${gates.fails.length} impeditivo${gates.fails.length > 1 ? 's' : ''}`
                : gates.warns.length ? `${gates.warns.length} a confirmar`
                : 'condições ok'}
            </span>
          </button>

          <button className="tile" onClick={() => go('navegar')}>
            <IconRoute size={38} />
            <span className="t">Navegação</span>
            <span className="d">mapa · LZ · modo piloto</span>
            <span className="badge">{mission?.airTotal != null ? `aéreo ${fmtMin(mission.airTotal)}` : 'sem cena'}</span>
          </button>

          <button className="tile" onClick={() => go('paciente')}>
            <IconUsers size={38} />
            <span className="t">Paciente</span>
            <span className="d">ficha · prontuário</span>
            <span className={'badge ' + (patientWorthKeeping(patient) ? 'ok' : '')}>
              {patientWorthKeeping(patient) ? 'ficha iniciada' : 'ficha vazia'}
            </span>
          </button>

          <button className="tile" onClick={() => go('missao')}>
            <IconClock size={38} />
            <span className="t">Missão</span>
            <span className="d">horários · grupo · registro</span>
            <span className={'badge ' + (missionOpen === 'ativa' ? 'ok' : dbId == null ? 'warn' : '')}>
              {missionOpen === 'ativa' ? 'grupo acionado'
                : dbId == null ? 'não salvo'
                : `${Object.keys(events).length} horário${Object.keys(events).length === 1 ? '' : 's'}`}
            </span>
          </button>
        </div>
      )}

      {!wide && view !== 'hub' && view !== 'nav' && (
        <div className="viewbar">
          <button className="vtab home" onClick={() => go('hub')} title="Todas as telas"><IconLayers size={17} /></button>
          {VIEW_TABS.map(([v, label, Icon]) => (
            <button key={v} className={'vtab' + (view === v ? ' on' : '')} onClick={() => go(v)}>
              <Icon size={17} /> {label}
            </button>
          ))}
        </div>
      )}

      {(wide || view !== 'hub') && (
      <div className="wrap">
        {/* -------- coluna esquerda: avaliação -------- */}
        {(show('caso') || show('fatores') || show('paciente')) && (
        <div className="col">
          {show('caso') && (
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
          )}

          {show('caso') && (
          <div className="card" style={{ paddingBottom: 10 }}>
            <h2>
              <span className="step-num">2</span> Pontuação de elegibilidade
              <span className={'badge ' + (score.total >= 9 ? 'fail' : score.total >= 5 ? 'warn' : score.total > 0 ? 'ok' : '')}>{score.total} pts</span>
            </h2>
            <div className="small" style={{ marginBottom: 4 }}>
              Marque o que se aplica — itens <span className="auto-tag" style={{ fontStyle: 'normal' }}>AUTO</span> são calculados pelos tempos e podem ser sobrescritos.
            </div>
          </div>
          )}
          {show('caso') && (
          <Checklist isChecked={isChecked} isOverridden={isOverridden} onToggle={toggleItem} onReset={resetAuto} score={score} />
          )}

          {show('fatores') && (
          <div className="card">
            <h2><span className="step-num">3</span> Condições operacionais (gates)</h2>
            <GatesPanel gates={gates} manualVals={gateManual} onManual={(id, v) => setGateManual((p) => ({ ...p, [id]: v }))} onOverride={(id, v) => setGateOverrides((p) => { const n = { ...p }; if (v) n[id] = v; else delete n[id]; return n })} />
          </div>
          )}

          {show('caso') && (
          <div className="card">
            <h2>Observações da regulação</h2>
            <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="mecanismo, achados, decisão, contatos…" style={{ width: '100%' }} />
          </div>
          )}

          {show('paciente') && (
          <PatientForm
            patient={patient} onChange={updatePatient}
            sync={patientSync} soLocal={fichaSoLocal} enviando={enviandoFicha}
            onEnviar={enviarFichaLocal} />
          )}
        </div>
        )}

        {/* -------- coluna direita: mapa e operação -------- */}
        {(show('caso') || show('fatores') || show('navegar') || show('missao')) && (
        <div className="col">
          {show('navegar') && (
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
              communityLz={communityLz} aircraft={acft}
              focus={focus}
              baseLayer={baseLayer} googleKey={cfg.map?.googleKey || ''}
              onMapClick={onMapClick}
              onPointClick={setPhotoLz} photoCounts={photoCounts}
            />
            <div className="maplayers">
              <button className={baseLayer === 'dark' ? 'on' : ''} onClick={() => pickBaseLayer('dark')}>Mapa</button>
              <button className={baseLayer === 'sat' ? 'on' : ''} onClick={() => pickBaseLayer('sat')}>Satélite</button>
              <button className={baseLayer === 'hybrid' ? 'on' : ''} onClick={() => pickBaseLayer('hybrid')}>Híbrido</button>
            </div>
            <button className="navlaunch" onClick={() => go('nav')} title="Modo navegação do piloto — posição GPS ao vivo, rumo e ETE">
              <IconRoute size={15} /> Navegar
            </button>
          </div>
          )}

          {show('caso') && (
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
          )}

          {show('fatores') && (
          <div className="card">
            <h2><IconClock size={14} /> Tempos estimados {route == null && scene && !routeErr ? <span className="spin" /> : null}</h2>
            <TimePanel mission={mission} />
          </div>
          )}

          {show('fatores') && scene && (
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

          {show('fatores') && scene && (
            <div className="card">
              <h2><IconCloud size={14} /> Meteorologia</h2>
              <WeatherPanel wxScene={wxScene} wxBase={wxBase} wxErr={wxErr} metar={metar} daylight={daylight} />
            </div>
          )}

          {show('fatores') && scene && (
            <div className="card">
              <h2><IconAlert size={14} /> Alertas de segurança</h2>
              <AlertsPanel alerts={alerts} />
            </div>
          )}

          {show('missao') && scene && (
            <div className="card">
              <h2><IconRoute size={14} /> Acompanhamento da missão</h2>
              <Tracking events={events} onMark={markEvent} onEdit={editEvent} mission={mission} />
              {dbId == null ? (
                <div className="small" style={{ marginTop: 8 }}>
                  <b>Salve o caso</b> para que os horários — e o acionamento do grupo — cheguem ao servidor.
                </div>
              ) : missionOpen === 'ativa' ? (
                <div className="small" style={{ marginTop: 8 }}>
                  Grupo da missão <b>acionado</b>: cada horário marcado aqui é avisado no Telegram na hora.
                </div>
              ) : (
                <div className="small" style={{ marginTop: 8 }}>
                  Marcar <b>Acionamento do GOA autorizado</b> aciona o grupo da missão no Telegram e envia o briefing.
                </div>
              )}
              {liveMsg && (
                <div className="alert ok" style={{ marginTop: 8, marginBottom: 0 }}>
                  <IconUsers size={15} style={{ flex: 'none', marginTop: 1 }} />
                  <span>Atualizado em outra tela: <b>{liveMsg.quais}</b>{liveMsg.by ? <> · por {liveMsg.by}</> : null}</span>
                </div>
              )}
            </div>
          )}

          {show('missao') && scene && (
            <div className="card">
              <h2>
                <IconSave size={14} /> Registro
                <span className={'badge ' + (dbId != null && !autoSave?.err ? 'ok' : autoSave?.err ? 'fail' : '')} style={{ marginLeft: 'auto' }}>
                  {dbId == null ? 'Não salvo'
                    : autoSave?.err ? `Caso #${dbId} · sem gravar`
                    : `Caso #${dbId} · salvo ${autoSave?.at ? fmtClock(autoSave.at) : 'automaticamente'}`}
                </span>
                {missionOpen && (
                  <span className={'badge ' + (missionOpen === 'ativa' ? 'ok' : '')} style={{ marginLeft: 6 }}>
                    {missionOpen === 'ativa' ? 'Grupo acionado' : 'Missão encerrada'}
                  </span>
                )}
              </h2>
              <div className="row">
                <button className="btn" onClick={saveCase} disabled={saving}
                  title={dbId != null ? 'O caso já se grava sozinho a cada alteração; use para forçar agora' : 'Grava o caso no servidor'}>
                  {saving ? <span className="spin" /> : <IconSave size={14} />} {dbId != null ? 'Salvar agora' : 'Salvar caso'}
                </button>
                <button className="btn sec" onClick={notifyGroup} disabled={notifying}
                  title={missionOpen === 'ativa'
                    ? 'Reenvia o briefing da missão ao grupo do Telegram'
                    : 'Envia o briefing da missão ao grupo do Telegram (salva o caso antes). Marcar "Acionamento do GOA autorizado" faz isso sozinho.'}>
                  {notifying ? <span className="spin" /> : <IconUsers size={14} />} {missionOpen === 'ativa' ? 'Reenviar briefing' : 'Grupo da missão'}
                </button>
                <button className="btn sec" onClick={() => setShowCases(true)}><IconFolder size={14} /> Casos ({cases.length})</button>
                <button className="btn sec" onClick={copyResumo}><IconCopy size={14} /> Copiar resumo</button>
                <button className="btn sec" onClick={exportProntuario} title="Abre o prontuário do paciente em HTML para imprimir como PDF, anexar ao e-mail e assinar no gov.br"><IconPrint size={14} /> Prontuário (PDF)</button>
                <button className="btn sec" onClick={() => window.print()}><IconPrint size={14} /> Registro</button>
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
              {autoSave?.err && (
                <div className="alert fail" style={{ marginTop: 10, marginBottom: 0 }}>
                  <IconAlert size={15} style={{ flex: 'none', marginTop: 1 }} />
                  <span>
                    A gravação automática falhou ({autoSave.err}). O caso está guardado neste
                    aparelho e volta a subir na próxima alteração — ou clique em <b>Salvar agora</b>.
                  </span>
                </div>
              )}
              {notifyMsg && (
                <div className={'alert ' + (notifyMsg.ok ? 'ok' : 'fail')} style={{ marginTop: 10, marginBottom: 0 }}>
                  {notifyMsg.ok ? <IconUsers size={15} style={{ flex: 'none', marginTop: 1 }} /> : <IconAlert size={15} style={{ flex: 'none', marginTop: 1 }} />}
                  {notifyMsg.text}
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
        )}
      </div>
      )}

      <div className="footer">
        <b>SkyRescue β</b> — ferramenta de apoio à decisão em fase piloto. Não substitui o julgamento do médico regulador, os protocolos do SAMU 192 / SESAB, nem a decisão final do comandante da aeronave (GOA/CBMBA). Meteorologia (Open-Meteo) e áreas de pouso (OpenStreetMap) são indicativas e exigem confirmação operacional. Rotas terrestres via OSRM, sem trânsito em tempo real. Os casos são registrados no servidor do GOA com controle de acesso e autoria. Dados pessoais de paciente só na <b>Ficha do paciente</b>, que é restrita à equipe autorizada e tem todo acesso registrado — fora dela (identificador do caso, observações) não escreva dado identificável.
      </div>

      {showCfg && <ConfigModal cfg={cfg} onClose={() => setShowCfg(false)} onSave={(c) => { setCfg(c); saveCfg(c); setShowCfg(false) }} />}

      {view === 'nav' && (
        <NavMode
          cfg={cfg} scene={scene} lzPoint={lzPoint}
          hospital={hospital} landingHelipad={landingHelipad}
          events={events} onQuickMark={quickMarkEvent} onUndoMark={undoEvent}
          onClose={() => go(wide ? 'caso' : 'navegar')}
        />
      )}

      {/* chip flutuante de marcação rápida: aparece após o primeiro horário
          registrado e some quando a missão termina (todos os marcos feitos) */}
      {scene && view !== 'nav' && Object.keys(events).length > 0 && (
        <MilestoneQuick events={events} onMark={quickMarkEvent} onUndo={undoEvent} className="qmark-fab" />
      )}

      {photoLz && (
        <LzPhotoModal
          point={photoLz}
          user={user}
          onClose={() => setPhotoLz(null)}
          onChanged={() => { refreshPhotoCounts(); refreshCommunity() }}
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
        refMs={refMs} refFrozen={refAt != null}
      />
    </>
  )
}

function PrintSheet({ caseId, scene, sceneLabel, score, gates, rec, mission, hospital, landingHelipad, lzPoint, manualLz, wxScene, metar, events, notes, daylight, destinoLabel, refMs, refFrozen }) {
  const hits = Object.values(score.perSection).flatMap((s) => s.hits)
  const printedAt = new Date()
  const assessedAt = new Date(refMs)
  return (
    <div className="print-sheet">
      <h1>SkyRescue — Registro de avaliação para acionamento aeromédico</h1>
      {/* a avaliação vale para a hora do acionamento; a hora da impressão vai
          separada para o documento não se contradizer quando reimpresso */}
      <div>SAMU 192 Salvador × GOA/CBMBA · Avaliação: {assessedAt.toLocaleString('pt-BR')} {caseId ? `· Caso ${caseId}` : ''}</div>
      <div style={{ fontSize: 10, color: '#666' }}>
        Impresso em {printedAt.toLocaleString('pt-BR')}. Todos os critérios abaixo — inclusive a janela diurna — referem-se à hora da avaliação{refFrozen ? '' : ' (avaliação em curso)'}.
      </div>

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
