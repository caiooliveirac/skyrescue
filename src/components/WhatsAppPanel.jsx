import { useEffect, useState } from 'react'
import { api } from '../lib/backend.js'
import { IconX } from './Icons.jsx'

// Painel do bot do WhatsApp (só admin, dentro de Config). É por aqui que o
// chip da regulação é pareado ao servidor — sem SSH, sem log: o código de
// pareamento aparece na tela e a pessoa digita no celular do chip. Também
// mostra o grupo vinculado, os plantonistas que recebem no privado e um botão
// de teste. Enquanto aberto, consulta o status a cada 3 s: o pareamento é
// uma conversa entre o servidor e o WhatsApp, e a tela precisa acompanhar.

const STATUS = {
  desligado: ['Desligado no servidor (WHATSAPP_DISABLED)', 'fail'],
  sem_sessao: ['Nenhum chip pareado', 'warn'],
  pareando: ['Aguardando pareamento no celular…', 'warn'],
  conectando: ['Conectando…', 'warn'],
  conectado: ['Conectado', 'ok'],
}

const pretty = (d) => {
  const m = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(String(d || ''))
  return m ? `+55 ${m[1]} ${m[2]}-${m[3]}` : d ? `+${d}` : ''
}
const when = (ts) => ts ? new Date(ts).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''

export default function WhatsAppPanel() {
  const [s, setS] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState('')
  const [phone, setPhone] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [newName, setNewName] = useState('')
  const [test, setTest] = useState(null)

  const refresh = () => api.waStatus().then((r) => { setS(r); setErr('') }).catch((e) => setErr(e.message))
  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 3000)
    return () => clearInterval(t)
  }, [])

  const run = async (key, fn) => {
    setBusy(key); setErr('')
    try { const r = await fn(); if (r && r.status) setS(r); else await refresh() }
    catch (e) { setErr(e.message) }
    finally { setBusy('') }
  }

  if (!s && !err) return <div className="small">Consultando o bot…</div>

  const [label, cls] = STATUS[s?.status] || ['—', '']
  const conectado = s?.status === 'conectado'
  const vincular = `/vincular ${s?.linkCode || '<código>'}`

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <span className={'badge ' + cls}>{label}</span>
        {conectado && <span className="mono">{pretty(s.me)}</span>}
        {conectado && <span className="small">desde {when(s.connectedAt)}</span>}
        {conectado && (
          <button className="btn xs warn" disabled={!!busy}
            onClick={() => { if (confirm('Desconectar o chip do servidor? Os avisos param até parear de novo.')) run('logout', api.waLogout) }}>
            desconectar
          </button>
        )}
      </div>
      {(err || s?.lastError) && <div className="small" style={{ color: 'var(--fail)', marginBottom: 8 }}>{err || s.lastError}</div>}

      {!conectado && s?.status !== 'desligado' && (
        <div className="field" style={{ marginBottom: 12 }}>
          <label>Parear o chip da regulação</label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <input type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
              placeholder="número do chip: (71) 9 9999-9999" style={{ flex: 1, minWidth: 180 }} />
            <button className="btn xs" disabled={!!busy || phone.replace(/\D/g, '').length < 10}
              onClick={() => run('pair', () => api.waPair(phone))}>
              {busy === 'pair' ? '…' : 'gerar código'}
            </button>
            <button className="btn xs sec" disabled={!!busy} onClick={() => run('qr', () => api.waPair(''))}>
              {busy === 'qr' ? '…' : 'ou QR code'}
            </button>
          </div>
          {s?.pairing && (
            <div style={{ marginTop: 8, padding: 12, borderRadius: 10, background: 'var(--accent-soft)', border: '1px solid var(--accent-line)' }}>
              <div className="mono" style={{ fontSize: 30, letterSpacing: '0.12em', textAlign: 'center', fontWeight: 700 }}>{s.pairing.code}</div>
              <div className="small" style={{ marginTop: 6, lineHeight: 1.5 }}>
                No celular do chip ({pretty(s.pairing.phone)}): WhatsApp → <b>⋮ / Configurações</b> → <b>Dispositivos conectados</b> →{' '}
                <b>Conectar dispositivo</b> → <b>Conectar com número de telefone</b> → digite o código.
                O código vale poucos minutos; se expirar, gere outro.
              </div>
            </div>
          )}
          {s?.qrDataUrl && !s?.pairing && (
            <div style={{ marginTop: 8, textAlign: 'center' }}>
              <img src={s.qrDataUrl} alt="QR code de pareamento" style={{ width: 220, height: 220, borderRadius: 8, background: '#fff', padding: 6 }} />
              <div className="small" style={{ marginTop: 6 }}>
                No celular do chip: <b>Dispositivos conectados</b> → <b>Conectar dispositivo</b> → aponte a câmera. O QR se renova sozinho.
              </div>
            </div>
          )}
          <div className="small" style={{ marginTop: 6 }}>
            O servidor vira um "dispositivo conectado" do chip (como o WhatsApp Web). O celular do chip precisa continuar com internet e com o WhatsApp instalado.
          </div>
        </div>
      )}

      <div className="field" style={{ marginBottom: 12 }}>
        <label>Grupo que recebe os acionamentos</label>
        {s?.group ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <b>{s.group.title || s.group.jid}</b>
            <span className="small">vinculado por {s.group.linked_by || '—'} em {when(s.group.linked_at)}</span>
            <button className="btn xs sec" disabled={!!busy}
              onClick={() => { if (confirm('Desvincular o grupo? Os acionamentos deixam de chegar nele.')) run('unbind', api.waUnbindGroup) }}>
              desvincular
            </button>
          </div>
        ) : (
          <div className="small" style={{ lineHeight: 1.6 }}>
            Nenhum grupo vinculado. Para vincular: <b>1)</b> adicione o chip{s?.me ? ` (${pretty(s.me)})` : ''} ao grupo;{' '}
            <b>2)</b> qualquer pessoa no grupo manda a mensagem{' '}
            <code className="mono" style={{ userSelect: 'all' }}>{vincular}</code>
            {s?.linkCode && (
              <button className="btn xs ghost" style={{ marginLeft: 6 }} onClick={() => navigator.clipboard?.writeText(vincular)}>copiar</button>
            )}
            . O bot responde "✅ Grupo ligado ao SkyRescue".
            {!s?.linkCodeSet && <> <span style={{ color: 'var(--fail)' }}>BOT_LINK_CODE não está definido no servidor.</span></>}
          </div>
        )}
      </div>

      <div className="field" style={{ marginBottom: 12 }}>
        <label>Plantonistas que recebem no privado</label>
        {(s?.recipients || []).map((r) => (
          <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0' }}>
            <label className="chk" style={{ display: 'flex', margin: 0, flex: 1 }}>
              <input type="checkbox" checked={!!r.active} disabled={!!busy}
                onChange={(e) => run('r' + r.id, () => api.waSetRecipient(r.id, e.target.checked))} />
              <div><b>{r.name || 'sem nome'}</b> <span className="mono small">{pretty(r.phone)}</span></div>
            </label>
            <button className="btn xs warn" disabled={!!busy} title="remover"
              onClick={() => { if (confirm(`Remover ${r.name || pretty(r.phone)} dos avisos?`)) run('d' + r.id, () => api.waRemoveRecipient(r.id)) }}>
              <IconX size={11} />
            </button>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
          <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="nome" style={{ flex: 1, minWidth: 120 }} />
          <input type="tel" inputMode="tel" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} placeholder="(71) 9 9999-9999" style={{ flex: 1, minWidth: 150 }} />
          <button className="btn xs" disabled={!!busy || newPhone.replace(/\D/g, '').length < 10}
            onClick={() => run('add', async () => { await api.waAddRecipient(newPhone, newName); setNewPhone(''); setNewName('') })}>
            + incluir
          </button>
        </div>
        <div className="small" style={{ marginTop: 4 }}>
          Quem mandar <code className="mono">{vincular}</code> no privado do chip também entra na lista sozinho.
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn xs sec" disabled={!!busy || !conectado}
          onClick={() => run('test', async () => { setTest(await api.waTest()); return null })}>
          {busy === 'test' ? '…' : 'enviar mensagem de teste'}
        </button>
        {test && (
          <span className="small">
            {test.status === 'ok' ? '✅ chegou a todos' : test.status === 'parcial' ? '⚠️ chegou a parte' : `❌ ${test.status}`}
            {test.detail && Object.keys(test.detail).length > 0 && (
              <> — {Object.entries(test.detail).map(([k, v]) => `${k === 'group' ? 'grupo' : pretty(k)}: ${v === true ? 'ok' : v === false ? 'falhou' : v}`).join(' · ')}</>
            )}
          </span>
        )}
      </div>
    </div>
  )
}
