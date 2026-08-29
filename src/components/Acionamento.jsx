import { useState } from 'react'
import { IconHeli } from './Icons.jsx'

// Tela pública: é o que qualquer pessoa vê ao cair no site, antes de login.
// Dois caminhos — acionar o GOA (formulário) ou acompanhar um acionamento já
// feito. O envio de fato acontece pelo WhatsApp: o botão abre a conversa com
// a mensagem já montada. Login da equipe fica num botão discreto no canto.

// edite aqui a lista de centrais (botões, na ordem)
const CENTRAIS = ['Salvador', 'Feira de Santana', 'Alagoinhas', 'SAJ', 'Itabuna', 'Camaçari']
const TIPOS = ['Trauma', 'AVC', 'IAM', 'Outro']
const WHATSAPP = '5571988161438' // +55 71 98816-1438

// pergunta extra de cada tipo: [rótulo, tipo de input] — IAM não pede nada
const DETALHE = {
  Trauma: ['Que tipo de trauma?', 'text', 'ex.: TCE grave, trauma torácico…'],
  AVC: ['Hora do ictus', 'time', ''],
  Outro: ['Descreva a ocorrência', 'text', 'o que está acontecendo?'],
}

const IconWhats = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M6.62 10.79a15.05 15.05 0 0 0 6.59 6.59l2.2-2.2a1 1 0 0 1 1.02-.24c1.12.37 2.33.57 3.57.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1C10.61 21 3 13.39 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.24.2 2.45.57 3.57a1 1 0 0 1-.25 1.02l-2.2 2.2Z" />
  </svg>
)

export default function Acionamento({ onLogin }) {
  const [tela, setTela] = useState('home') // 'home' | 'acionar'
  const [central, setCentral] = useState('')
  const [medico, setMedico] = useState('')
  const [fone, setFone] = useState('')
  const [tipo, setTipo] = useState('')
  const [detalhe, setDetalhe] = useState('')
  const [done, setDone] = useState(false)

  const pedeDetalhe = DETALHE[tipo]
  const ok = central && medico.trim() && fone.replace(/\D/g, '').length >= 10 && tipo &&
    (!pedeDetalhe || detalhe.trim())

  const waLink = (msg) => `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(msg)}`
  const waAcionar = () => waLink([
    'ACIONAMENTO AEROMÉDICO — SkyRescue',
    `Central: SAMU ${central}`,
    `Médico(a): ${medico.trim()}`,
    `Contato: ${fone.trim()}`,
    `Tipo: ${tipo}${tipo === 'AVC' ? ` (ictus ${detalhe})` : pedeDetalhe ? ` — ${detalhe.trim()}` : ''}`,
  ].join('\n'))
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
            {TIPOS.map((t) => pick(t, tipo, (v) => { setTipo(v); setDetalhe('') }))}
          </div>
        </div>

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
