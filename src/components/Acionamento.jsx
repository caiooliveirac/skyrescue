import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import GoogleMutant from 'leaflet.gridlayer.googlemutant'
import { IconHeli } from './Icons.jsx'
import { geocode, reverseGeocode } from '../lib/api.js'
import { api } from '../lib/backend.js'
import { loadGoogleMaps, googleAuthFailed, watchMutant } from '../lib/gmaps.js'

// Tela pública: é o que qualquer pessoa vê ao cair no site, antes de login.
// Dois caminhos — acionar o GOA ou acompanhar um acionamento já feito.
// "Acionar" começa pelo ENDEREÇO: confirmou o local, o servidor grava o pedido
// (POST /api/acionamentos) e o bot do WhatsApp já avisa o grupo do GOA e os
// plantonistas. Só então vem a passagem do caso (o que é, paciente, quem
// pede), que completa o mesmo pedido (PATCH) e sai como segunda mensagem —
// alertando se o endereço mudou. Se o aviso não puder ser confirmado (bot
// fora, servidor fora), a tela devolve o plano B de sempre: abrir o WhatsApp
// da própria pessoa com o texto pronto para o número da regulação. Login da
// equipe fica num botão discreto no canto.

// edite aqui a lista de centrais (botões, na ordem)
const CENTRAIS = ['Salvador', 'Feira de Santana', 'Alagoinhas', 'SAJ', 'Itabuna', 'Camaçari']
const TIPOS = ['Trauma', 'AVC', 'IAM', 'Outro']
// plano B (e "acompanhar"): WhatsApp pessoal da regulação — +55 71 98816-1438
const WHATSAPP = '5571988161438'

// pergunta extra de cada tipo: [rótulo, tipo de input, placeholder] — IAM não pede nada
const DETALHE = {
  AVC: ['Hora do ictus', 'time', ''],
  Outro: ['Descreva a ocorrência', 'text', 'o que está acontecendo?'],
}
// trauma tem botões prontos; "Outro" abre texto livre
const TRAUMAS = ['Ac. Moto', 'Ac. Carro', 'Ac. Ônibus / Van', 'Explosão / Queimadura', 'Múltiplas Vítimas', 'Outro']

const IconWhats = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M6.62 10.79a15.05 15.05 0 0 0 6.59 6.59l2.2-2.2a1 1 0 0 1 1.02-.24c1.12.37 2.33.57 3.57.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1C10.61 21 3 13.39 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.24.2 2.45.57 3.57a1 1 0 0 1-.25 1.02l-2.2 2.2Z" />
  </svg>
)

// pino sem asset de imagem: o ícone padrão do Leaflet depende de PNGs que o
// build single-file não resolve; um divIcon com emoji funciona em qualquer tela
const PIN = L.divIcon({
  className: '',
  html: '<div style="font-size:30px;line-height:30px;transform:translate(-50%,-100%);text-shadow:0 1px 3px rgba(0,0,0,.6)">📍</div>',
  iconSize: [0, 0],
})

const ESRI_IMAGERY = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
// rótulos sem chave (CARTO passou a exigir API key) — ver MapView.jsx
const ESRI_LABELS = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'

// Mapa de apontar o local, satélite com rótulos por padrão — o que mais ajuda
// quem reconhece o posto/o galpão mas não sabe o nome da rua. Mesmo padrão da
// tela logada (MapView): camada Google híbrida via GoogleMutant quando a chave
// funciona, senão Esri World Imagery + rótulos Carto. O GoogleMutant mantém o
// mapa Google interno num div oculto, então o aviso "for development purposes
// only" do billing não aparece para o usuário — só deixa de usar o Google.
// O caminho principal continua sendo DIGITAR e escolher na busca; toque refina.
export function MapaLocal({ pin, onPin }) {
  const boxRef = useRef(null)
  const mapRef = useRef(null)
  const markRef = useRef(null)
  const onPinRef = useRef(onPin)
  onPinRef.current = onPin

  useEffect(() => {
    const map = L.map(boxRef.current, {
      // Salvador + RMS: o grosso dos acionamentos; a busca recentra os demais
      center: pin ? [pin.lat, pin.lon] : [-12.85, -38.42],
      zoom: pin ? 16 : 10,
      zoomControl: true,
    })
    map.on('click', (e) => onPinRef.current({ lat: e.latlng.lat, lon: e.latlng.lng }))
    mapRef.current = map

    let cancelled = false
    // Esri entra JÁ — o mapa nunca abre vazio esperando o Google. Se a camada
    // Google confirmar tiles (chave ok, billing ok), ela assume e o Esri sai;
    // senão (BillingNotEnabled etc.) o Esri simplesmente fica.
    let esriLayers = [
      L.tileLayer(ESRI_IMAGERY, { maxZoom: 19, attribution: 'Imagens © Esri, Maxar' }).addTo(map),
      L.tileLayer(ESRI_LABELS, { maxZoom: 20, maxNativeZoom: 16, attribution: 'Esri, HERE, Garmin, &copy; OpenStreetMap' }).addTo(map),
    ]
    const key = import.meta.env.VITE_GMAPS_KEY
    if (key && !googleAuthFailed()) {
      loadGoogleMaps(key)
        .then(() => {
          if (cancelled || googleAuthFailed()) return
          const g = new GoogleMutant({ type: 'hybrid', maxZoom: 21 })
          watchMutant(
            g,
            () => { if (!cancelled) map.removeLayer(g) },
            7000,
            () => {
              if (cancelled) return
              esriLayers.forEach((l) => map.removeLayer(l))
              esriLayers = []
            }
          )
          g.addTo(map)
        })
        .catch(() => { /* Esri já está na tela */ })
    }
    return () => { cancelled = true; map.remove(); mapRef.current = null }
  }, []) // eslint-disable-line

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (!pin) { markRef.current?.remove(); markRef.current = null; return }
    if (!markRef.current) {
      markRef.current = L.marker([pin.lat, pin.lon], { icon: PIN, draggable: true }).addTo(map)
      markRef.current.on('dragend', () => {
        const p = markRef.current.getLatLng()
        onPinRef.current({ lat: p.lat, lon: p.lng })
      })
    } else {
      markRef.current.setLatLng([pin.lat, pin.lon])
    }
    // busca nova recentra; toque/arraste dentro da tela visível não recentra
    if (!map.getBounds().contains([pin.lat, pin.lon]) || map.getZoom() < 13) {
      map.setView([pin.lat, pin.lon], Math.max(map.getZoom(), 16))
    }
  }, [pin]) // eslint-disable-line

  return <div ref={boxRef} style={{ height: 280, borderRadius: 10, overflow: 'hidden' }} />
}

const hhmm = (ts) => new Date(ts || Date.now()).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
const chegou = (r) => !!r && !r.error && (r.whatsapp === 'ok' || r.whatsapp === 'parcial')

export default function Acionamento({ onLogin }) {
  // 'home' → 'local' (endereço: ao confirmar, o GOA já é avisado) → 'dados'
  // (o que é, paciente, quem pede: a passagem completa do caso)
  const [tela, setTela] = useState('home')
  const [central, setCentral] = useState('')
  const [medico, setMedico] = useState('')
  const [fone, setFone] = useState('')
  const [tipo, setTipo] = useState('')
  const [trauma, setTrauma] = useState('') // botão escolhido quando tipo = Trauma
  const [detalhe, setDetalhe] = useState('')
  // paciente: o que se souber — "Ignorado" vale como resposta
  const [pacNome, setPacNome] = useState('')
  const [pacIdade, setPacIdade] = useState('')
  const [done, setDone] = useState(false)
  const [sending, setSending] = useState(false)
  // primeiro aviso (só o endereço): null | { sending } | { id, token, whatsapp, hora } | { error }
  const [aviso, setAviso] = useState(null)
  const avisoRef = useRef(null)          // promessa do primeiro aviso, para a passagem esperar por ele
  const [localAvisado, setLocalAvisado] = useState(null) // { txt, lat, lon } que foi no primeiro aviso
  // resposta da passagem completa: { id, whatsapp: 'ok'|'parcial'|…, hora } ou { error }
  const [result, setResult] = useState(null)

  // local da ocorrência: texto livre + pino no mapa (um dos dois basta)
  const [localTxt, setLocalTxt] = useState('')
  const [buscando, setBuscando] = useState(false)
  const [resultados, setResultados] = useState(null) // null = sem busca; [] = nada achado
  const [pin, setPin] = useState(null)               // {lat, lon}
  const [pinLabel, setPinLabel] = useState('')       // endereço aproximado do pino
  const revRef = useRef(0)

  const buscar = async () => {
    const q = localTxt.trim()
    if (!q || buscando) return
    setBuscando(true); setResultados(null)
    try {
      const sufixo = /bahia|\bba\b/i.test(q) ? '' : ', Bahia'
      setResultados(await geocode(q + sufixo))
    } catch (e) {
      setResultados([])
    } finally {
      setBuscando(false)
    }
  }

  const marcarPin = (p, label) => {
    setPin(p)
    if (label) { setPinLabel(label); revRef.current++; return }
    // toque/arraste no mapa: descobre o endereço para a pessoa CONFERIR em
    // texto que marcou o lugar certo — quem é ruim de mapa confere pelo nome
    const seq = ++revRef.current
    setPinLabel('…')
    reverseGeocode(p.lat, p.lon).then((l) => {
      if (seq === revRef.current) setPinLabel(l || '')
    })
  }

  const pedeDetalhe = DETALHE[tipo]
  // Trauma: exige um botão; "Outro" (do trauma ou do tipo) exige o texto
  const traumaOk = tipo !== 'Trauma' || (trauma && (trauma !== 'Outro' || detalhe.trim()))
  const pinOk = pin && pinLabel !== '…' ? pinLabel : ''
  // o endereço mínimo: o que foi escrito, senão o que o pino achou
  const localFinal = localTxt.trim() || pinOk || (pin ? `Ponto no mapa ${pin.lat.toFixed(5)}, ${pin.lon.toFixed(5)}` : '')
  const ok = central && medico.trim() && fone.replace(/\D/g, '').length >= 10 && tipo &&
    (!pedeDetalhe || detalhe.trim()) && traumaOk && localFinal && pacNome.trim() && pacIdade.trim()

  // o detalhe do tipo como vai no aviso: subtipo do trauma, hora do ictus ou texto livre
  const detalheTxt = tipo === 'Trauma' ? (trauma === 'Outro' ? detalhe.trim() : trauma)
    : tipo === 'AVC' ? (detalhe ? `ictus ${detalhe}` : '')
    : pedeDetalhe ? detalhe.trim() : ''
  // "apelido" da ocorrência: o que foi descrito clicando — "AVC ictus 10:30"
  const apelido = [tipo, detalheTxt].filter(Boolean).join(' ')
  const pedidoId = result?.id || aviso?.id
  const mudouLocal = !!localAvisado && (localAvisado.txt !== localFinal ||
    localAvisado.lat !== (pin?.lat ?? null) || localAvisado.lon !== (pin?.lon ?? null))

  const waLink = (msg) => `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(msg)}`
  const waAcionar = () => {
    const linhas = [
      'ACIONAMENTO AEROMÉDICO — SkyRescue',
      pedidoId ? `Pedido #${pedidoId}${apelido ? ` · ${apelido}` : ''} (registrado no site)` : null,
      `Central: SAMU ${central}`,
      `Médico(a): ${medico.trim()}`,
      `Contato: ${fone.trim()}`,
      `Tipo: ${tipo}${detalheTxt ? ` — ${detalheTxt}` : ''}`,
      `Paciente: ${pacNome.trim()} · idade ${pacIdade.trim()}`,
      `Local: ${localFinal}`,
    ].filter(Boolean)
    if (pin) {
      if (pinOk) linhas.push(`Ponto no mapa: ${pinOk}`)
      linhas.push(`Coordenadas: ${pin.lat.toFixed(5)}, ${pin.lon.toFixed(5)}`)
      linhas.push(`https://maps.google.com/?q=${pin.lat.toFixed(5)},${pin.lon.toFixed(5)}`)
    }
    return waLink(linhas.join('\n'))
  }
  const waAcompanhar = waLink('Olá! Gostaria de acompanhar um acionamento aeromédico já realizado.')

  const corpoLocal = () => ({ local: localFinal, lat: pin?.lat, lon: pin?.lon, pinLabel: pinOk })

  // Confirmar o endereço JÁ aciona: o grupo do GOA e os plantonistas recebem o
  // primeiro aviso só com o local, e a pessoa segue preenchendo o resto. Se o
  // endereço for trocado depois, a passagem completa avisa a alteração.
  const confirmarLocal = () => {
    if (!localFinal) return
    setTela('dados'); window.scrollTo(0, 0)
    if (avisoRef.current) return // já avisado: a mudança de endereço vai na passagem
    setLocalAvisado({ txt: localFinal, lat: pin?.lat ?? null, lon: pin?.lon ?? null })
    setAviso({ sending: true })
    avisoRef.current = api.acionar(corpoLocal()).then(
      (r) => { const a = { ...r, hora: hhmm(r.createdAt) }; setAviso(a); return a },
      (e) => { const a = { error: e.message || 'falha de rede' }; setAviso(a); return a }
    )
  }

  // Passagem completa do caso. Completa o pedido do primeiro aviso; se ele não
  // chegou a ser registrado, manda tudo de uma vez. Qualquer falha vira o
  // plano B (WhatsApp da pessoa) no modal — nunca uma tela de erro sem saída.
  const acionar = async () => {
    if (!ok || sending) return
    setSending(true)
    setResult(null)
    setDone(true)
    try {
      const a = await avisoRef.current
      const corpo = {
        ...corpoLocal(), central, medico: medico.trim(), fone: fone.trim(), tipo, detalhe: detalheTxt,
        pacienteNome: pacNome.trim(), pacienteIdade: pacIdade.trim(),
      }
      const r = a?.id && a.token
        ? await api.completarAcionamento(a.id, { ...corpo, token: a.token })
        : await api.acionar(corpo)
      if (r.token) { // pedido novo (o primeiro aviso não tinha saído): as correções passam a mirar nele
        avisoRef.current = Promise.resolve(r)
        setLocalAvisado({ txt: localFinal, lat: pin?.lat ?? null, lon: pin?.lon ?? null })
      }
      setResult({ ...r, hora: hhmm() })
    } catch (e) {
      setResult({ error: e.message || 'falha de rede' })
    } finally {
      setSending(false)
    }
  }
  const entregue = chegou(result)

  const pick = (val, cur, set) => (
    <button
      key={val}
      type="button"
      className={`btn ${cur === val ? '' : 'sec'}`}
      style={{ justifyContent: 'center', minHeight: 46 }}
      onClick={() => set(val)}
    >
      {val}
    </button>
  )
  // campo que aceita "Ignorado" como resposta (dado do paciente ainda desconhecido)
  const comIgnorado = (label, val, set, props) => (
    <div className="field">
      <label>{label}</label>
      <div style={{ display: 'flex', gap: 8 }}>
        <input {...props} value={val === 'Ignorado' ? '' : val} disabled={val === 'Ignorado'}
          placeholder={val === 'Ignorado' ? 'ignorado' : props.placeholder}
          onChange={(e) => set(e.target.value)} style={{ flex: 1, minWidth: 0 }} />
        <button type="button" className={`btn ${val === 'Ignorado' ? '' : 'sec'}`} aria-pressed={val === 'Ignorado'}
          onClick={() => set(val === 'Ignorado' ? '' : 'Ignorado')}>
          Ignorado
        </button>
      </div>
    </div>
  )

  const brand = (
    <div className="login-brand">
      <div className="logo-mark"><IconHeli size={24} /></div>
      <div>
        <div className="logo-word">SkyRescue<span className="beta">BETA</span></div>
        <div className="sub">Acionamento aeromédico · SAMU 192 × GOA/CBMBA</div>
      </div>
    </div>
  )

  if (tela === 'home') {
    return (
      <div className="login-bg" style={{ position: 'relative' }}>
        <button className="btn sec xs" type="button" onClick={onLogin}
          style={{ position: 'absolute', top: 14, right: 14 }}>
          Equipe
        </button>
        <div className="login-card">
          {brand}
          <button className="btn" type="button" onClick={() => setTela('local')}
            style={{ width: '100%', justifyContent: 'center', minHeight: 76, fontSize: 19, gap: 12, marginTop: 8 }}>
            <span style={{ fontSize: 34 }} aria-hidden="true">🚁</span> Acionar GOA
          </button>
          <a className="btn sec" href={waAcompanhar} target="_blank" rel="noopener noreferrer"
            style={{ width: '100%', justifyContent: 'center', minHeight: 48, marginTop: 10 }}>
            Acompanhar acionamento já realizado
          </a>
        </div>
      </div>
    )
  }

  if (tela === 'local') {
    const jaAvisado = !!aviso
    return (
      <div className="login-bg">
        <form className="login-card" onSubmit={(e) => { e.preventDefault(); confirmarLocal() }}>
          {brand}

          <div className="login-title">{jaAvisado ? 'Alterar o endereço' : 'Onde é a ocorrência?'}</div>

          <div className="field">
            <label>Local da ocorrência</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="text"
                autoFocus
                value={localTxt}
                onChange={(e) => setLocalTxt(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); buscar() } }}
                placeholder="endereço, rodovia + km ou referência"
                style={{ flex: 1, minWidth: 0 }}
              />
              <button type="button" className="btn sec" onClick={buscar} disabled={buscando || !localTxt.trim()}>
                {buscando ? <span className="spin" /> : 'Buscar'}
              </button>
            </div>
            <div className="small" style={{ marginTop: 2 }}>
              Escreva o que souber (ex.: “BR-324 km 520, perto do posto”) e busque,
              ou toque direto no mapa. Dá para detalhar depois.
            </div>
          </div>

          {resultados && (
            <div className="field" style={{ gap: 6 }}>
              {resultados.length === 0 && (
                <div className="small">Nada encontrado — tente rua + cidade, ou toque direto no mapa abaixo.</div>
              )}
              {resultados.slice(0, 4).map((r, i) => (
                <button key={i} type="button" className="btn sec"
                  style={{ justifyContent: 'flex-start', textAlign: 'left', fontSize: 13, whiteSpace: 'normal', lineHeight: 1.35 }}
                  onClick={() => { marcarPin({ lat: r.lat, lon: r.lon }, r.label); setResultados(null) }}>
                  📍 {r.label}
                </button>
              ))}
            </div>
          )}

          <div className="field">
            <MapaLocal pin={pin} onPin={marcarPin} />
            <div className="small" style={{ marginTop: 4 }}>
              {pin
                ? <>Ponto marcado{pinLabel && pinLabel !== '…' ? <>: <strong>{pinLabel}</strong></> : ''}. Toque ou arraste o 📍 para ajustar.</>
                : 'Toque no mapa no ponto da ocorrência (aproxime com dois dedos).'}
            </div>
          </div>

          <button className="btn" type="submit" disabled={!localFinal}
            style={{ width: '100%', justifyContent: 'center', marginTop: 4, minHeight: 56, fontSize: 16 }}>
            {jaAvisado ? 'Confirmar novo endereço' : '🚁 Confirmar endereço e acionar o GOA'}
          </button>
          <div className="small" style={{ marginTop: 8, textAlign: 'center' }}>
            {jaAvisado
              ? 'O novo endereço segue na passagem do caso, com aviso de que houve alteração.'
              : <>Ao confirmar, <strong>o GOA já é avisado</strong> com este endereço. Os dados do caso você preenche em seguida.</>}
          </div>

          <div className="small" style={{ marginTop: 12, textAlign: 'center' }}>
            <a href="#" onClick={(e) => { e.preventDefault(); setTela(jaAvisado ? 'dados' : 'home') }}>← Voltar</a>
          </div>
        </form>
      </div>
    )
  }

  return (
    <div className="login-bg">
      <form className="login-card" onSubmit={(e) => { e.preventDefault(); acionar() }}>
        {brand}

        {/* o que aconteceu com o primeiro aviso — a pessoa precisa saber se o GOA já sabe */}
        {aviso?.sending && (
          <div className="alert info"><span className="spin" /> <span>Avisando o GOA do endereço…</span></div>
        )}
        {aviso && !aviso.sending && chegou(aviso) && (
          <div className="alert ok"><span>✅ <strong>GOA avisado às {aviso.hora}</strong> · pedido <strong>#{aviso.id}</strong>.
            Agora complete a passagem do caso.</span></div>
        )}
        {aviso && !aviso.sending && !chegou(aviso) && (
          <div className="alert warn"><span>
            {aviso.error
              ? <>O primeiro aviso <strong>não saiu</strong> ({aviso.error}). </>
              : <>Pedido <strong>#{aviso.id}</strong> registrado, mas o aviso automático não foi confirmado. </>}
            Complete e envie abaixo — se não chegar, a tela oferece o seu WhatsApp.</span></div>
        )}

        <div className="login-title">Passagem do caso</div>

        <div className="field">
          <label>Local da ocorrência</label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ flex: 1, minWidth: 0, fontSize: 14, lineHeight: 1.35 }}>
              📍 {localFinal}
              {pinOk && pinOk !== localFinal && <div className="small">{pinOk}</div>}
            </div>
            <button type="button" className="btn sec xs" onClick={() => setTela('local')}>Alterar</button>
          </div>
          {mudouLocal && (
            <div className="small" style={{ color: 'var(--warn)', marginTop: 2 }}>
              Endereço diferente do primeiro aviso — a passagem vai alertar a alteração.
            </div>
          )}
        </div>

        <div className="field">
          <label>O que é?</label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {TIPOS.map((t) => pick(t, tipo, (v) => { setTipo(v); setTrauma(''); setDetalhe('') }))}
          </div>
        </div>

        {tipo === 'Trauma' && (
          <div className="field">
            <label>Que tipo de trauma?</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {TRAUMAS.map((t) => pick(t, trauma, (v) => { setTrauma(v); setDetalhe('') }))}
            </div>
            {trauma === 'Outro' && (
              <input
                type="text"
                value={detalhe}
                onChange={(e) => setDetalhe(e.target.value)}
                placeholder="ex.: queda de altura, FAF…"
                style={{ marginTop: 8 }}
              />
            )}
          </div>
        )}

        {pedeDetalhe && (
          <div className="field">
            <label>{pedeDetalhe[0]}</label>
            <input
              type={pedeDetalhe[1]}
              value={detalhe}
              onChange={(e) => setDetalhe(e.target.value)}
              placeholder={pedeDetalhe[2]}
            />
          </div>
        )}

        {comIgnorado('Nome do paciente', pacNome, setPacNome, { type: 'text', placeholder: 'nome, se souber' })}
        {comIgnorado('Idade estimada', pacIdade, setPacIdade, { type: 'text', inputMode: 'numeric', placeholder: 'ex.: 45' })}

        <div className="field">
          <label>De qual central você está falando?</label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {CENTRAIS.map((c) => pick(c, central, setCentral))}
          </div>
        </div>

        <div className="field">
          <label>Nome do médico</label>
          <input
            type="text"
            autoComplete="name"
            value={medico}
            onChange={(e) => setMedico(e.target.value)}
            placeholder="nome completo"
          />
        </div>

        <div className="field">
          <label>Telefone para contato</label>
          <input
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={fone}
            onChange={(e) => setFone(e.target.value)}
            placeholder="(71) 9 9999-9999"
          />
        </div>

        <button className="btn" type="submit" disabled={!ok || sending}
          style={{ width: '100%', justifyContent: 'center', marginTop: 4, minHeight: 48 }}>
          {sending ? <span className="spin" /> : result && !result.error ? 'Reenviar passagem (corrigida)' : 'Enviar passagem do caso'}
        </button>
        {!ok && (
          <div className="small" style={{ marginTop: 8, textAlign: 'center' }}>
            Preencha tudo para enviar — no nome e na idade do paciente vale tocar em <strong>Ignorado</strong>.
          </div>
        )}
      </form>

      {done && (
        <div className="modal-bg" onClick={() => { if (!sending) setDone(false) }}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 380 }}>
            {sending && (
              <>
                <h3>Enviando a passagem do caso…</h3>
                <p style={{ margin: '0 0 12px', lineHeight: 1.5, display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span className="spin" /> Avisando a regulação pelo WhatsApp.
                </p>
              </>
            )}

            {!sending && entregue && (
              <>
                <h3>✅ Passagem enviada</h3>
                <p style={{ margin: '0 0 12px', lineHeight: 1.5 }}>
                  Ocorrência <strong>#{result.id} · {result.apelido || apelido}</strong> avisada à regulação pelo
                  WhatsApp às <strong>{result.hora}</strong>
                  {result.enderecoAlterado ? ', com alerta de endereço alterado' : ''}
                  {result.grupo === false || (result.privados?.total && result.privados.ok < result.privados.total)
                    ? ' (parte dos destinatários não confirmou)' : ''}.{' '}
                  <strong>Fique atento ao telefone informado</strong> — a regulação vai ligar.
                </p>
                <button className="btn" type="button" onClick={() => setDone(false)}
                  style={{ width: '100%', justifyContent: 'center', minHeight: 48 }}>
                  OK
                </button>
                <a className="btn sec" href={waAcionar()} target="_blank" rel="noopener noreferrer"
                  style={{ width: '100%', justifyContent: 'center', marginTop: 8, gap: 8 }}>
                  <IconWhats size={16} /> Reforçar pelo meu WhatsApp
                </a>
              </>
            )}

            {!sending && !entregue && (
              <>
                <h3>Envie pelo WhatsApp</h3>
                <p style={{ margin: '0 0 12px', lineHeight: 1.5 }}>
                  {result?.error
                    ? <>Não foi possível registrar a passagem no servidor ({result.error}). </>
                    : <>A ocorrência <strong>#{result?.id}</strong> foi registrada, mas o aviso automático
                        não pôde ser confirmado. </>}
                  Toque no botão abaixo para enviar o acionamento pelo WhatsApp e{' '}
                  <strong>fique atento ao telefone informado</strong> — a regulação
                  entrará em contato.
                </p>
                <a className="btn" href={waAcionar()} target="_blank" rel="noopener noreferrer"
                  style={{ width: '100%', justifyContent: 'center', minHeight: 52, gap: 10, background: '#25D366', color: '#fff', border: 'none' }}>
                  <IconWhats size={22} /> Enviar pelo WhatsApp
                </a>
                {result?.error && (
                  <button className="btn sec" type="button" onClick={acionar}
                    style={{ width: '100%', justifyContent: 'center', marginTop: 8 }}>
                    Tentar de novo
                  </button>
                )}
                <button className="btn sec" type="button" onClick={() => setDone(false)}
                  style={{ width: '100%', justifyContent: 'center', marginTop: 8 }}>
                  Voltar
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
