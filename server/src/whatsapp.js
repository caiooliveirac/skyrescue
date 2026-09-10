// Canal WhatsApp do bot da missão — o mesmo bot do Telegram, num número.
//
// Quem fala com o WhatsApp é o wa-bridge (server/wa-bridge, Go + whatsmeow),
// um processo local: POST /send envia; mensagem recebida vira POST em
// /api/wa/inbound aqui. Este arquivo só traduz: HTML dos templates do
// Telegram -> formatação do WhatsApp, e palavras -> os mesmos HANDLERS.
//
// Sem WA_BRIDGE_URL no ambiente: dry-run (loga no console), igual ao Telegram.
// Vincular o grupo/número: enviar "vincular <código>" (BOT_LINK_CODE).

import { query } from './db.js'
import { HANDLERS, confirmMission, currentMission, linkChat, linkCodeOk, tgSend } from './telegram.js'

const BRIDGE = process.env.WA_BRIDGE_URL || ''
const SECRET = process.env.WA_SECRET || ''
const dry = !BRIDGE

// HTML do Telegram -> texto do WhatsApp (*negrito*, _itálico_, `mono`, link solto)
export function htmlToWa(html) {
  return String(html)
    .replace(/<a href="([^"]+)">([^<]*)<\/a>/g, (_, u, t) => (t.trim() ? `${t}: ${u}` : u))
    .replace(/<\/?b>/g, '*').replace(/<\/?i>/g, '_').replace(/<\/?code>/g, '`')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
}

export async function waSend(jid, html) {
  const text = htmlToWa(html)
  if (dry) { console.log(`[wa dry-run → ${jid}]\n${text}\n`); return }
  const res = await fetch(`${BRIDGE}/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-WA-Secret': SECRET },
    body: JSON.stringify({ to: jid, text }),
  })
  if (!res.ok) throw new Error(`wa-bridge ${res.status}: ${await res.text().catch(() => '')}`)
}

export async function boundWa() {
  const { rows } = await query('SELECT chat_id FROM bot_chat WHERE id = 2')
  return rows[0]?.chat_id || null
}

// no WhatsApp não há botão nem menu "/": palavras fazem o papel
const CONFIRM = { lz: /^lz\s*(ok|segura|pronta)$/, pass: /^passagem\s*(ok|feita)$/ }
const AJUDA_WA = [
  '🚁 *SkyRescue — bot da missão*',
  'Eu falo sozinho nos momentos que importam: briefing ao acionar, cada horário marcado, avisos de deslocamento e o encerramento.',
  '',
  'Responda com uma palavra:',
  '*caso* — briefing da missão ativa',
  '*tempos* — horários marcados e o que falta',
  '*goa* — onde está a aeronave agora',
  '*lz* — checklist do ponto de encontro · *lz ok* confirma LZ segura',
  '*passagem* — cobrar a passagem do caso · *passagem feita* confirma',
  '',
  '⚠️ _Sem dados pessoais do paciente neste grupo._',
].join('\n')

// mensagem recebida pelo bridge: {chat, sender, name, text, isGroup}
export async function onWaMessage({ chat, sender, name, text }) {
  const reply = (html) => waSend(chat, html)
  const t = String(text || '').trim().toLowerCase().replace(/^\//, '')
  const [cmd, arg] = t.split(/\s+/)
  if (cmd === 'vincular') {
    if (!linkCodeOk(arg)) return reply('❌ Código inválido. Use <code>vincular &lt;código&gt;</code> (BOT_LINK_CODE no servidor).')
    await linkChat(2, chat, name)
    return reply('✅ WhatsApp vinculado ao SkyRescue. Os briefings de missão chegam aqui.\n\n' + AJUDA_WA)
  }
  if (cmd === 'ajuda' || cmd === 'start' || cmd === 'menu' || cmd === 'oi') return reply(AJUDA_WA)
  for (const [kind, re] of Object.entries(CONFIRM)) {
    if (!re.test(t)) continue
    const m = await currentMission()
    if (!m) return reply('Nenhuma missão ativa no momento.')
    const html = await confirmMission(kind, m.case_id, name || sender.split('@')[0])
    // eco no grupo que confirmou; o Telegram recebe pelo broadcast do Node
    // apenas quando a missão tem grupo lá (chat_id > 0)
    await reply(html)
    if (m.chat_id) await tgSend(m.chat_id, html).catch((e) => console.error('[wa] eco tg:', e.message))
    return
  }
  const handler = HANDLERS[cmd]
  if (handler) return handler(reply)
  // texto qualquer num grupo: silêncio (é conversa da equipe); no privado, o menu
  if (!chat.endsWith('@g.us')) return reply(AJUDA_WA)
}
