// Bot do WhatsApp — o chip da regulação avisa o acionamento feito no site.
//
// Antes, a tela pública "Acionar GOA" só abria o WhatsApp de quem preenchia
// com o texto pronto, endereçado a UM celular: nada ficava registrado e o
// aviso dependia do médico da rua ter WhatsApp, apertar "enviar" e o dono
// daquele número ver. Aqui o servidor mesmo manda, pelo chip da regulação
// pareado como "dispositivo conectado" (WhatsApp Web), para o GRUPO vinculado
// e para os plantonistas no privado — o mesmo desenho do bot do Telegram
// (telegram.js), só que no canal em que a equipe já vive.
//
// Ligação: Config → WhatsApp (admin) gera um código de pareamento (ou QR);
// no celular do chip: Dispositivos conectados → Conectar dispositivo →
// "Conectar com número de telefone" → digitar o código. A sessão fica em
// disco (WA_AUTH_DIR, fora do rsync do deploy) e sobrevive a restart.
// Grupo: adicionar o chip ao grupo e alguém mandar `/vincular <BOT_LINK_CODE>`.
//
// Sem sessão o servidor sobe normal: o acionamento continua sendo gravado e
// a tela pública devolve o botão do WhatsApp da pessoa como plano B.
// WHATSAPP_DISABLED=1 desliga tudo (ex.: máquina de dev).
//
// Uma sessão por chip: dois servidores pareados no mesmo chip derrubam um ao
// outro (connectionReplaced). Ao migrar de servidor, desconecte no antigo.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pino from 'pino'
import QRCode from 'qrcode'
import * as baileys from '@whiskeysockets/baileys'
import { query } from './db.js'

const {
  makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers,
  fetchLatestBaileysVersion, jidNormalizedUser, isJidGroup, extractMessageContent,
} = baileys

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const AUTH_DIR = process.env.WA_AUTH_DIR || path.join(__dirname, '..', '.wa-auth')
const DISABLED = /^(1|true|sim|yes)$/i.test(process.env.WHATSAPP_DISABLED || '')
// lido na hora (o teste define depois do import; em produção vem do .env)
const linkCode = () => process.env.BOT_LINK_CODE || ''
const TZ = 'America/Bahia'
const SEND_TIMEOUT_MS = 20_000
const PAIR_WINDOW_MS = 5 * 60_000   // quanto tempo insistimos renovando o código de pareamento
const MAX_BACKOFF_MS = 60_000

const logger = pino({ level: process.env.WA_LOG_LEVEL || 'error' })

// ---------- estado (o que o painel de Config mostra) ----------
// status: 'desligado' | 'sem_sessao' | 'conectando' | 'pareando' | 'conectado'
const st = {
  status: DISABLED ? 'desligado' : 'sem_sessao',
  me: null,          // número do chip (só dígitos), quando conectado
  pairing: null,     // { code, phone, at }
  qr: null,          // string do QR atual (o painel converte em imagem)
  lastError: null,
  connectedAt: null,
  attempts: 0,
}
let sock = null
let starting = null
let reconnectTimer = null
let wantPairPhone = null   // número para o qual pedir código quando o socket abrir
let pairStartedAt = 0
const jidCache = new Map()  // telefone → jid confirmado por onWhatsApp

// ---------- utilitários puros (testados em scripts/test-whatsapp.js) ----------
export const onlyDigits = (s) => String(s ?? '').replace(/\D/g, '')

// telefone digitado de qualquer jeito → só dígitos com DDI. Sem DDI assume
// Brasil (é o caso de todo mundo aqui). Devolve null se não parecer telefone.
export function normalizePhone(s) {
  let d = onlyDigits(s)
  if (!d) return null
  if (d.length === 10 || d.length === 11) d = '55' + d        // DDD + número
  if (d.length < 12 || d.length > 15) return null
  return d
}

const phoneOfJid = (jid) => onlyDigits(String(jid || '').split('@')[0].split(':')[0])

const fmtWhen = (ts) =>
  new Date(ts).toLocaleString('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

// telefone bonito para ler no grupo: 5571981619480 → +55 71 98161-9480
export function prettyPhone(d) {
  d = onlyDigits(d)
  const m = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(d)
  return m ? `+55 ${m[1]} ${m[2]}-${m[3]}` : d ? `+${d}` : ''
}

// texto do aviso — WhatsApp usa *negrito* e _itálico_. Sem dado de paciente:
// quem pede, de onde, o que é e onde; o resto se resolve no telefone.
export function formatAcionamento(a) {
  const L = [
    `🚁 *ACIONAMENTO AEROMÉDICO — SkyRescue*`,
    `#${a.id} · ${fmtWhen(a.created_at || Date.now())}`,
    '',
    `🏥 *Central:* SAMU ${a.central}`,
    `👨‍⚕️ *Médico(a):* ${a.medico}`,
  ]
  const fone = normalizePhone(a.fone)
  L.push(`📞 *Contato:* ${a.fone}${fone ? `\n   wa.me/${fone}` : ''}`)
  L.push(`🩺 *Tipo:* ${a.tipo}${a.detalhe ? ` — ${a.detalhe}` : ''}`)
  L.push(`📍 *Local:* ${a.local_txt}`)
  if (a.lat != null && a.lon != null) {
    if (a.pin_label) L.push(`🗺️ ${a.pin_label}`)
    L.push(`https://maps.google.com/?q=${Number(a.lat).toFixed(5)},${Number(a.lon).toFixed(5)}`)
  }
  L.push('', '_Regulação: ligar para o médico solicitante e abrir o caso no SkyRescue._')
  return L.join('\n')
}

// "/vincular ABC", "vincular ABC", "/vincular@bot ABC" → { cmd, arg, prefixed }
// Só "vincular" vale sem a barra (é o que a pessoa vai digitar de cabeça);
// o resto exige "/" para o bot não responder a "ajuda" dito numa conversa.
export function parseCommand(text) {
  const m = /^\s*([/!]?)([a-zA-Zçã]+)(?:@\S+)?(?:\s+(\S+))?/.exec(String(text || ''))
  if (!m) return null
  const cmd = m[2].toLowerCase()
  const prefixed = !!m[1]
  if (!prefixed && cmd !== 'vincular') return null
  return { cmd, arg: m[3] || '', prefixed }
}

// texto de uma mensagem recebida, seja qual for o envelope (efêmera, view
// once…) — extractMessageContent desembrulha; o resto é o campo
export function textOf(msg) {
  const c = extractMessageContent(msg?.message)
  return c?.conversation || c?.extendedTextMessage?.text || ''
}

// ---------- socket ----------
const hasRegisteredCreds = () => {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(AUTH_DIR, 'creds.json'), 'utf8'))
    return !!j.registered || !!j.me?.id
  } catch (e) { return false }
}

function wipeAuth() {
  try { fs.rmSync(AUTH_DIR, { recursive: true, force: true }) } catch (e) { /* ok */ }
  jidCache.clear()
}

function scheduleReconnect(ms) {
  if (reconnectTimer) return
  reconnectTimer = setTimeout(() => { reconnectTimer = null; connect() }, ms)
  reconnectTimer.unref?.()
}

// solta o socket atual ANTES de encerrá-lo: o 'close' que ele emite é
// ignorado pelo guard (s !== sock) e não dispara reconexão em cima do novo
function dropSocket(reason) {
  const old = sock
  sock = null
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
  if (old) { try { old.end?.(new Error(reason)) } catch (e) { /* ok */ } }
}

async function askPairingCode(s, phone) {
  if (s._skyCodeAsked) return
  s._skyCodeAsked = true
  const raw = await s.requestPairingCode(phone)
  const code = raw.length === 8 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw
  st.pairing = { code, phone, at: Date.now() }
  console.log(`[wa] código de pareamento para +${phone}: ${code}`)
}

async function connect() {
  if (DISABLED || sock) return
  if (starting) return starting
  starting = (async () => {
    try {
      fs.mkdirSync(AUTH_DIR, { recursive: true, mode: 0o700 })
      const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR)
      let version
      try { ({ version } = await withTimeout(fetchLatestBaileysVersion(), 8_000, 'versão')) } catch (e) { /* usa a versão embutida */ }
      const s = makeWASocket({
        auth: state,
        version,
        logger,
        browser: Browsers.ubuntu('Chrome'),
        markOnlineOnConnect: false,           // o celular do chip continua tocando
        syncFullHistory: false,
        shouldSyncHistoryMessage: () => false,
        generateHighQualityLinkPreview: false,
        getMessage: async () => undefined,
      })
      sock = s
      st.status = state.creds.registered ? 'conectando' : 'pareando'
      st.qr = null
      s.ev.on('creds.update', saveCreds)
      s.ev.on('connection.update', async (u) => {
        if (s !== sock) return   // socket velho falando depois de trocado
        try {
          if (u.qr) {
            st.qr = u.qr
            st.status = 'pareando'
            // pedir o código só depois do primeiro QR: é quando o socket está
            // de fato aberto e registrado para a troca
            if (wantPairPhone) await askPairingCode(s, wantPairPhone)
          }
          if (u.connection === 'connecting' && state.creds.registered) st.status = 'conectando'
          if (u.connection === 'open') {
            st.status = 'conectado'
            st.me = phoneOfJid(jidNormalizedUser(s.user?.id || ''))
            st.pairing = null; st.qr = null; st.lastError = null
            st.connectedAt = Date.now(); st.attempts = 0
            wantPairPhone = null; pairStartedAt = 0
            console.log(`[wa] conectado como +${st.me}`)
          }
          if (u.connection === 'close') onClose(u.lastDisconnect)
        } catch (e) {
          st.lastError = e.message
          console.error('[wa] connection.update:', e.message)
        }
      })
      s.ev.on('messages.upsert', (m) => onMessages(s, m).catch((e) => console.error('[wa] mensagem:', e.message)))
    } catch (e) {
      st.lastError = e.message
      st.status = hasRegisteredCreds() ? 'conectando' : 'sem_sessao'
      console.error('[wa] falha ao abrir socket:', e.message)
      if (hasRegisteredCreds()) scheduleReconnect(backoff())
    } finally {
      starting = null
    }
  })()
  return starting
}

const backoff = () => Math.min(MAX_BACKOFF_MS, 2000 * 2 ** Math.min(st.attempts++, 5))

function onClose(lastDisconnect) {
  const err = lastDisconnect?.error
  const code = err?.output?.statusCode ?? err?.data?.statusCode
  const msg = err?.message || String(code || 'sem motivo')
  sock = null
  st.qr = null
  if (code === DisconnectReason.loggedOut) {
    // o chip removeu o dispositivo: a sessão morreu, não adianta insistir
    wipeAuth()
    st.status = 'sem_sessao'; st.me = null; st.pairing = null
    st.lastError = 'sessão encerrada no celular — pareie de novo'
    console.log('[wa] sessão encerrada pelo celular; sessão local apagada')
    return
  }
  if (code === DisconnectReason.connectionReplaced) {
    st.status = 'sem_sessao'; st.lastError = 'outra instância assumiu este chip (servidor duplicado?)'
    console.error('[wa] conexão substituída por outra instância — não reconecto sozinho')
    return
  }
  if (!hasRegisteredCreds()) {
    // ninguém digitou o código/leu o QR a tempo: renova por alguns minutos,
    // depois desiste para não ficar pedindo QR ao WhatsApp para sempre
    if (pairStartedAt && Date.now() - pairStartedAt < PAIR_WINDOW_MS) {
      st.status = 'pareando'
      scheduleReconnect(1500)
    } else {
      const expired = !!pairStartedAt
      wantPairPhone = null; pairStartedAt = 0
      st.status = 'sem_sessao'; st.pairing = null
      st.lastError = expired ? 'tempo de pareamento esgotado — gere outro código' : null
    }
    return
  }
  // sessão válida caiu (rede, 515 depois do pareamento, celular offline): volta
  st.status = 'conectando'
  st.lastError = msg
  const wait = code === DisconnectReason.restartRequired ? 500 : backoff()
  console.log(`[wa] desconectado (${msg}); reconectando em ${wait} ms`)
  scheduleReconnect(wait)
}

// ---------- mensagens recebidas: só o que o bot entende ----------
async function replyTo(s, jid, text) {
  await s.sendMessage(jid, { text })
}

async function onMessages(s, { type, messages }) {
  if (type !== 'notify') return
  for (const m of messages || []) {
    const text = textOf(m)
    if (!text) continue
    const p = parseCommand(text)
    if (!p) continue
    const chat = m.key.remoteJid
    if (!chat || chat === 'status@broadcast') continue
    if (p.cmd === 'vincular') await handleVincular(s, m, chat, p.arg)
    else if (p.cmd === 'ajuda' || p.cmd === 'ping') {
      await replyTo(s, chat, [
        '🚁 *SkyRescue — bot do acionamento*',
        'Eu aviso aqui cada acionamento feito no site goa.mnrs.com.br.',
        '',
        'Num grupo: `/vincular <código>` faz os avisos chegarem nele.',
        'No privado: `/vincular <código>` inclui você nos avisos.',
      ].join('\n'))
    }
  }
}

async function handleVincular(s, m, chat, code) {
  if (!linkCode()) {
    await replyTo(s, chat, '❌ O servidor não tem BOT_LINK_CODE configurado; peça ao administrador.')
    return
  }
  if (code !== linkCode()) {
    await replyTo(s, chat, '❌ Código inválido. Use `/vincular <código>` — o código está com o administrador do SkyRescue.')
    return
  }
  const who = m.pushName || phoneOfJid(m.key.participant || chat) || 'alguém'
  if (isJidGroup(chat)) {
    let title = null
    try { title = (await s.groupMetadata(chat))?.subject || null } catch (e) { /* sem nome */ }
    await query(
      `INSERT INTO wa_chat (id, jid, title, linked_by) VALUES (1, $1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET jid = EXCLUDED.jid, title = EXCLUDED.title,
         linked_by = EXCLUDED.linked_by, linked_at = now()`,
      [chat, title, who]
    )
    console.log(`[wa] grupo vinculado: ${title || chat} (por ${who})`)
    await replyTo(s, chat, `✅ Grupo *${title || 'vinculado'}* ligado ao SkyRescue. Cada acionamento feito no site chega aqui.`)
    return
  }
  // privado: quem manda passa a receber os avisos. Com LID (identidade nova do
  // WhatsApp) o número vem no campo "Alt"; sem ele, não dá para saber o telefone
  const jidPn = [chat, m.key.remoteJidAlt].find((j) => j && j.endsWith('@s.whatsapp.net'))
    || (await pnForLid(s, chat))
  const phone = jidPn ? phoneOfJid(jidPn) : null
  if (!phone) {
    await replyTo(s, chat, '⚠️ Não consegui identificar seu número. Peça ao administrador para incluir você em Config → WhatsApp.')
    return
  }
  await query(
    `INSERT INTO wa_recipient (phone, name) VALUES ($1, $2)
     ON CONFLICT (phone) DO UPDATE SET active = TRUE, name = coalesce(wa_recipient.name, EXCLUDED.name)`,
    [phone, m.pushName || null]
  )
  jidCache.set(phone, jidPn || `${phone}@s.whatsapp.net`)
  console.log(`[wa] destinatário incluído: +${phone} (${who})`)
  await replyTo(s, chat, `✅ Pronto, ${who}: você recebe aqui cada acionamento feito no site.`)
}

async function pnForLid(s, jid) {
  try {
    if (!jid?.endsWith('@lid')) return null
    return (await s.signalRepository?.lidMapping?.getPNForLID?.(jid)) || null
  } catch (e) { return null }
}

// ---------- envio ----------
const withTimeout = (p, ms, what) => Promise.race([
  p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${what}: tempo esgotado`)), ms).unref?.()),
])

// telefone → jid que o WhatsApp confirma existir. Número brasileiro antigo
// pode viver sem o nono dígito no WhatsApp: testa as duas formas.
async function resolveJid(s, phone) {
  if (jidCache.has(phone)) return jidCache.get(phone)
  const candidates = [phone]
  const br = /^55(\d{2})9(\d{8})$/.exec(phone)
  if (br) candidates.push(`55${br[1]}${br[2]}`)
  for (const c of candidates) {
    try {
      const r = await withTimeout(s.onWhatsApp(c), 10_000, 'onWhatsApp')
      const hit = r?.find((x) => x.exists)
      if (hit) { jidCache.set(phone, hit.jid); return hit.jid }
    } catch (e) { /* tenta o próximo / cai no padrão */ }
  }
  return `${phone}@s.whatsapp.net`
}

export async function activeRecipients() {
  const { rows } = await query('SELECT id, phone, name, active, created_at FROM wa_recipient ORDER BY created_at')
  return rows
}

export async function boundGroup() {
  const { rows } = await query('SELECT jid, title, linked_by, linked_at FROM wa_chat WHERE id = 1')
  return rows[0] || null
}

// manda `text` para o grupo vinculado e para os destinatários ativos.
// Devolve { status, detail } — 'ok' | 'parcial' | 'falhou' | 'desconectado' | 'desligado'
export async function broadcast(text) {
  const detail = {}
  if (DISABLED) return { status: 'desligado', detail }
  const s = sock
  if (!s || st.status !== 'conectado') return { status: 'desconectado', detail }
  const targets = []
  const g = await boundGroup()
  if (g) targets.push({ key: 'group', jid: g.jid })
  for (const r of await activeRecipients()) {
    if (r.active) targets.push({ key: r.phone, jid: null, phone: r.phone })
  }
  if (!targets.length) return { status: 'falhou', detail: { motivo: 'nenhum grupo vinculado nem destinatário ativo' } }
  await Promise.all(targets.map(async (t) => {
    try {
      const jid = t.jid || (await resolveJid(s, t.phone))
      await withTimeout(s.sendMessage(jid, { text }), SEND_TIMEOUT_MS, 'sendMessage')
      detail[t.key] = true
    } catch (e) {
      detail[t.key] = false
      console.error(`[wa] falha ao enviar para ${t.key}:`, e.message)
    }
  }))
  const oks = Object.values(detail).filter(Boolean).length
  return { status: oks === targets.length ? 'ok' : oks ? 'parcial' : 'falhou', detail }
}

// aviso do acionamento público; grava o resultado na própria linha
export async function notifyAcionamento(row) {
  const r = await broadcast(formatAcionamento(row))
  await query(
    `UPDATE acionamento SET wa_status = $2, wa_detail = $3, wa_sent_at = CASE WHEN $2 IN ('ok','parcial') THEN now() END
      WHERE id = $1`,
    [row.id, r.status, r.detail]
  ).catch((e) => console.error('[wa] gravar resultado:', e.message))
  return r
}

// ---------- painel de administração ----------
export async function getStatus() {
  const [group, recipients] = await Promise.all([boundGroup(), activeRecipients()])
  let qrDataUrl = null
  if (st.qr && st.status === 'pareando') {
    try { qrDataUrl = await QRCode.toDataURL(st.qr, { margin: 1, width: 260 }) } catch (e) { /* sem QR */ }
  }
  return {
    status: st.status,
    me: st.me,
    pairing: st.pairing,
    qrDataUrl,
    lastError: st.lastError,
    connectedAt: st.connectedAt,
    linkCodeSet: !!linkCode(),
    // o admin vê o código para mandar no grupo (a rota é só de admin)
    linkCode: linkCode() || null,
    group,
    recipients,
  }
}

// gera um código de pareamento para o número do chip (sem número: só QR)
export async function requestPairing(phoneRaw) {
  if (DISABLED) throw new Error('WhatsApp desligado neste servidor (WHATSAPP_DISABLED)')
  if (st.status === 'conectado') throw new Error(`já conectado como +${st.me}; desconecte antes de parear outro chip`)
  const phone = phoneRaw ? normalizePhone(phoneRaw) : null
  if (phoneRaw && !phone) throw new Error('número inválido — use DDD + número, ex.: 71 99999-9999')
  wantPairPhone = phone
  pairStartedAt = Date.now()
  st.pairing = null; st.lastError = null; st.attempts = 0
  // socket já esperando com QR e ainda sem código pedido: pede nele; em
  // qualquer outro caso derruba e abre um novo (código novo = sessão nova)
  if (sock && st.status === 'pareando' && st.qr && phone && !sock._skyCodeAsked) {
    try { await askPairingCode(sock, phone) }
    catch (e) { dropSocket('novo pareamento'); await connect() }
  } else {
    dropSocket('novo pareamento')
    await connect()
  }
  // espera o código (ou o QR) aparecer, até ~12 s, para a resposta já vir com ele
  const until = Date.now() + 12_000
  while (Date.now() < until && !(phone ? st.pairing : st.qr) && st.status !== 'conectado') {
    await new Promise((r) => setTimeout(r, 300))
  }
  return getStatus()
}

export async function logout() {
  const s = sock
  sock = null
  wantPairPhone = null; pairStartedAt = 0
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
  if (s) {
    // logout avisa o celular para remover o dispositivo; se não der, só encerra
    try { await withTimeout(s.logout(), 8_000, 'logout') } catch (e) { try { s.end?.() } catch (_) { /* ok */ } }
  }
  wipeAuth()
  st.status = DISABLED ? 'desligado' : 'sem_sessao'
  st.me = null; st.pairing = null; st.qr = null; st.lastError = null
  return getStatus()
}

export async function addRecipient(phoneRaw, name) {
  const phone = normalizePhone(phoneRaw)
  if (!phone) throw new Error('número inválido — use DDD + número, ex.: 71 99999-9999')
  const { rows } = await query(
    `INSERT INTO wa_recipient (phone, name) VALUES ($1, $2)
     ON CONFLICT (phone) DO UPDATE SET active = TRUE, name = coalesce(EXCLUDED.name, wa_recipient.name)
     RETURNING id, phone, name, active, created_at`,
    [phone, name ? String(name).trim().slice(0, 80) : null]
  )
  return rows[0]
}

export async function setRecipientActive(id, active) {
  const { rows } = await query(
    'UPDATE wa_recipient SET active = $2 WHERE id = $1 RETURNING id, phone, name, active, created_at',
    [id, !!active]
  )
  return rows[0] || null
}

export async function removeRecipient(id) {
  const { rowCount } = await query('DELETE FROM wa_recipient WHERE id = $1', [id])
  return rowCount > 0
}

export async function unbindGroup() {
  await query('DELETE FROM wa_chat WHERE id = 1')
}

export function startWhatsApp() {
  if (DISABLED) {
    console.log('[wa] WHATSAPP_DISABLED — bot do WhatsApp desligado')
    return
  }
  if (hasRegisteredCreds()) {
    console.log(`[wa] sessão encontrada em ${AUTH_DIR}; conectando`)
    connect()
  } else {
    console.log(`[wa] sem sessão em ${AUTH_DIR} — pareie o chip em Config → WhatsApp (admin)`)
  }
}

// só para os testes: injeta um socket falso e expõe o handler de mensagens
export const _test = {
  setSocket(fake) { sock = fake; st.status = fake ? 'conectado' : 'sem_sessao'; st.me = fake ? '5571900000000' : null; jidCache.clear() },
  onMessages: (m) => onMessages(sock, m),
  state: st,
}
