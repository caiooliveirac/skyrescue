import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { IconHeli } from './Icons.jsx'
import { geocode, reverseGeocode } from '../lib/api.js'

// Tela pública: é o que qualquer pessoa vê ao cair no site, antes de login.
// Dois caminhos — acionar o GOA (formulário) ou acompanhar um acionamento já
// feito. O envio de fato acontece pelo WhatsApp: o botão abre a conversa com
// a mensagem já montada. Login da equipe fica num botão discreto no canto.

// edite aqui a lista de centrais (botões, na ordem)
const CENTRAIS = ['Salvador', 'Feira de Santana', 'Alagoinhas', 'SAJ', 'Itabuna', 'Camaçari']
const TIPOS = ['Trauma', 'AVC', 'IAM', 'Outro']
const WHATSAPP = '5571988161438' // +55 71 98816-1438

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

// Mapa de apontar o local. Quem liga muitas vezes é ruim de mapa: o caminho
// principal é DIGITAR o que sabe e escolher um resultado da busca — o mapa
// entra já centrado no lugar certo e o toque só refina. Satélite ajuda quem
// reconhece o posto/o galpão mas não sabe o nome da rua.
function MapaLocal({ pin, onPin }) {
  const boxRef = useRef(null)
  const mapRef = useRef(null)
  const markRef = useRef(null)
  const [sat, setSat] = useState(false)
  const layersRef = useRef(null)

  useEffect(() => {
    const map = L.map(boxRef.current, {
      center: pin ? [pin.lat, pin.lon] : [-12.6, -38.9], // Bahia, entre as centrais
      zoom: pin ? 15 : 7,
      zoomControl: true,
    })
    const ruas = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap', maxZoom: 19,
    })
    const esri = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { attribution: 'Esri', maxZoom: 19 }
    )
    ruas.addTo(map)
    layersRef.current = { ruas, esri }
    map.on('click', (e) => onPin({ lat: e.latlng.lat, lon: e.latlng.lng }))
    mapRef.current = map
    return () => map.remove()
  }, []) // eslint-disable-line

  useEffect(() => {
    const { ruas, esri } = layersRef.current || {}
    if (!mapRef.current || !ruas) return
    if (sat) { mapRef.current.removeLayer(ruas); esri.addTo(mapRef.current) }
    else { mapRef.current.removeLayer(esri); ruas.addTo(mapRef.current) }
  }, [sat])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (!pin) { markRef.current?.remove(); markRef.current = null; return }
    if (!markRef.current) {
      markRef.current = L.marker([pin.lat, pin.lon], { icon: PIN, draggable: true }).addTo(map)
      markRef.current.on('dragend', () => {
        const p = markRef.current.getLatLng()
        onPin({ lat: p.lat, lon: p.lng })
      })
    } else {
      markRef.current.setLatLng([pin.lat, pin.lon])
    }
    // busca nova recentra; toque/arraste dentro da tela visível não recentra
    if (!map.getBounds().contains([pin.lat, pin.lon]) || map.getZoom() < 13) {
      map.setView([pin.lat, pin.lon], Math.max(map.getZoom(), 15))
    }
  }, [pin]) // eslint-disable-line

  return (
    <div style={{ position: 'relative' }}>
      <div ref={boxRef} style={{ height: 280, borderRadius: 10, overflow: 'hidden' }} />
      <button type="button" className="btn sec xs" onClick={() => setSat((s) => !s)}
        style={{ position: 'absolute', top: 8, right: 8, zIndex: 500 }}>
        {sat ? 'Mapa' : 'Satélite'}
      </button>
    </div>
  )
}

export default function Acionamento({ onLogin }) {
  const [tela, setTela] = useState('home') // 'home' | 'acionar'
  const [central, setCentral] = useState('')
  const [medico, setMedico] = useState('')
  const [fone, setFone] = useState('')
  const [tipo, setTipo] = useState('')
  const [trauma, setTrauma] = useState('') // botão escolhido quando tipo = Trauma
  const [detalhe, setDetalhe] = useState('')
  const [done, setDone] = useState(false)

  // local da ocorrência: texto livre (obrigatório) + pino no mapa (refinamento)
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
  const ok = central && medico.trim() && fone.replace(/\D/g, '').length >= 10 && tipo &&
    (!pedeDetalhe || detalhe.trim()) && traumaOk && localTxt.trim()

  const waLink = (msg) => `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(msg)}`
  const waAcionar = () => {
    const linhas = [
      'ACIONAMENTO AEROMÉDICO — SkyRescue',
      `Central: SAMU ${central}`,
      `Médico(a): ${medico.trim()}`,
      `Contato: ${fone.trim()}`,
      `Tipo: ${tipo}${
        tipo === 'Trauma' ? ` — ${trauma === 'Outro' ? detalhe.trim() : trauma}`
        : tipo === 'AVC' ? ` (ictus ${detalhe})`
        : pedeDetalhe ? ` — ${detalhe.trim()}` : ''}`,
      `Local: ${localTxt.trim()}`,
    ]
    if (pin) {
      if (pinLabel && pinLabel !== '…') linhas.push(`Ponto no mapa: ${pinLabel}`)
      linhas.push(`Coordenadas: ${pin.lat.toFixed(5)}, ${pin.lon.toFixed(5)}`)
      linhas.push(`https://maps.google.com/?q=${pin.lat.toFixed(5)},${pin.lon.toFixed(5)}`)
    }
    return waLink(linhas.join('\n'))
  }
  const waAcompanhar = waLink('Olá! Gostaria de acompanhar um acionamento aeromédico já realizado.')

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
          <button className="btn" type="button" onClick={() => setTela('acionar')}
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

  return (
    <div className="login-bg">
      <form className="login-card" onSubmit={(e) => { e.preventDefault(); if (ok) setDone(true) }}>
        {brand}

        <div className="login-title">Acionar o GOA</div>

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

        <div className="field">
          <label>Tipo de ocorrência</label>
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

        <div className="field">
          <label>Local da ocorrência</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              value={localTxt}
              onChange={(e) => setLocalTxt(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); buscar() } }}
              placeholder="endereço, rodovia + km ou referência"
              style={{ flex: 1 }}
            />
            <button type="button" className="btn sec" onClick={buscar} disabled={buscando || !localTxt.trim()}>
              {buscando ? <span className="spin" /> : 'Buscar'}
            </button>
          </div>
          <div className="small" style={{ marginTop: 2 }}>
            Escreva o que souber (ex.: “BR-324 km 520, perto do posto”). A busca
            ajuda a achar no mapa — depois toque no ponto exato.
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
              : 'Opcional: toque no mapa no ponto exato da ocorrência (aproxime com dois dedos).'}
          </div>
        </div>

        <button className="btn" type="submit" disabled={!ok}
          style={{ width: '100%', justifyContent: 'center', marginTop: 4, minHeight: 48 }}>
          Acionar
        </button>

        <div className="small" style={{ marginTop: 12, textAlign: 'center' }}>
          <a href="#" onClick={(e) => { e.preventDefault(); setTela('home') }}>← Voltar</a>
        </div>
      </form>

      {done && (
        <div className="modal-bg" onClick={() => setDone(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 380 }}>
            <h3>Acionamento pronto</h3>
            <p style={{ margin: '0 0 12px', lineHeight: 1.5 }}>
              Toque no botão abaixo para enviar o acionamento pelo WhatsApp e{' '}
              <strong>fique atento ao telefone informado</strong> — a regulação
              entrará em contato.
            </p>
            <a className="btn" href={waAcionar()} target="_blank" rel="noopener noreferrer"
              style={{ width: '100%', justifyContent: 'center', minHeight: 52, gap: 10, background: '#25D366', color: '#fff', border: 'none' }}>
              <IconWhats size={22} /> Enviar pelo WhatsApp
            </a>
            <button className="btn sec" type="button" onClick={() => setDone(false)}
              style={{ width: '100%', justifyContent: 'center', marginTop: 8 }}>
              Voltar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
