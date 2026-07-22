// Bot despachante da missão (Telegram) — fase 1, 100% determinístico.
//
// O bot só fala em gatilhos: briefing ao acionar o grupo, eco de cada
// horário marcado pelo comandante, ETE em deslocamento (cadência 5 min +
// alerta de ~2 min) e encerramento. Sem LLM: mensagens são templates.
//
// Sem TELEGRAM_BOT_TOKEN no ambiente, roda em DRY-RUN: loga no console o
// que enviaria (testável em dev; produção habilita só com a env).
// Vincular o grupo: adicionar o bot ao grupo e enviar /vincular <código>
// (código em BOT_LINK_CODE). Uma vinculação por instalação.

import { query } from './db.js'

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || ''
const LINK_CODE = process.env.BOT_LINK_CODE || ''
const API = `https://api.telegram.org/bot${TOKEN}`
const TZ = 'America/Bahia'

const dry = !TOKEN
let dryMsgId = 1000

// ---------- utilitários ----------
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const hhmm = (ts) =>
  new Date(ts).toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })

function toDDM(v, isLat) {
  const dir = isLat ? (v >= 0 ? 'N' : 'S') : (v >= 0 ? 'E' : 'W')
  const abs = Math.abs(v)
  const deg = Math.floor(abs)
  const min = ((abs - deg) * 60).toFixed(2).padStart(5, '0')
  return `${String(deg).padStart(isLat ? 2 : 3, '0')}°${min}'${dir}`
}
const fmtDDM = (p) => `${toDDM(p.lat, true)} ${toDDM(p.lon, false)}`
const mapsLink = (p) => `https://maps.google.com/?q=${p.lat.toFixed(6)},${p.lon.toFixed(6)}`

const haversineKm = (a, b) => {
  const r = (d) => (d * Math.PI) / 180
  const s1 = Math.sin(r(b.lat - a.lat) / 2) ** 2 +
    Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lon - a.lon) / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(s1))
}

async function tg(method, payload) {
  if (dry) {
    if (method === 'sendMessage') {
      console.log(`[bot dry-run → chat ${payload.chat_id}]\n${payload.text}\n`)
      return { ok: true, result: { message_id: ++dryMsgId } }
    }
    return { ok: true, result: {} }
  }
  const res = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await res.json().catch(() => ({}))
  if (!data.ok) console.error(`[bot] ${method}:`, data.description || res.status)
  return data
}

const send = (chatId, html, extra = {}) =>
  tg('sendMessage', { chat_id: chatId, text: html, parse_mode: 'HTML', disable_web_page_preview: true, ...extra })

// ---------- vinculação do grupo ----------
export async function boundChat() {
  const { rows } = await query('SELECT chat_id FROM bot_chat WHERE id = 1')
  return rows[0]?.chat_id || null
}

// ---------- marcos ----------
export const MILESTONES = [
  { id: 'decisao', label: 'Acionamento do GOA autorizado' },
  { id: 'decolagem', label: 'Decolagem da base' },
  { id: 'pouso_cena', label: 'Pouso na cena / LZ' },
  { id: 'paciente', label: 'Contato com o paciente' },
  { id: 'decolagem2', label: 'Decolagem para o destino' },
  { id: 'pouso_destino', label: 'Pouso no destino' },
  { id: 'entrega', label: 'Paciente entregue na unidade' },
  { id: 'livre', label: 'Aeronave liberada' },
]
const MILESTONE_BY_ID = Object.fromEntries(MILESTONES.map((m) => [m.id, m.label]))

// ponto de encontro da missão: LZ escolhida, senão a própria cena
const meetPoint = (snap) => snap?.lzPoint || (snap?.scene ? { name: 'Cena', ...snap.scene } : null)

// ---------- missão ativa: nunca uma missão fantasma ----------
// mission_chat.status só sai de 'ativa' quando alguém marca "Aeronave
// liberada". No plantão real isso falha o tempo todo (fim de turno, aba
// fechada, missão abortada) e a missão fica ativa para sempre — dias depois o
// bot volta a falar dela. Aconteceu: em 21/07/2026 a missão de 14/07 ainda
// estava 'ativa' e era o alvo do próximo /caso e dos avisos de deslocamento.
//
// Três defesas independentes, porque uma só sempre falha:
//   1. TTL na consulta — fora da janela o bot se cala, mesmo que a varredura
//      não tenha rodado (defesa que não depende de nada estar de pé);
//   2. varredura periódica que encerra as órfãs (impede de persistir);
//   3. abrir missão nova encerra as anteriores (só existe uma aeronave).
// Um voo aeromédico não passa de ~1 h; 12 h é folga para o caso de o marco
// final vir atrasado.
const MISSION_TTL_H = Number(process.env.MISSION_TTL_HOURS) || 12
// alvo a mais de 250 km não é desta missão (RMS de Salvador cabe em ~150 km):
// evita ETE absurdo se um caso antigo escapar das defesas acima
const MAX_ENROUTE_KM = 250

// a missão corrente do grupo — a mais recente ainda dentro do TTL
export async function currentMission() {
  const { rows } = await query(
    `SELECT c.id, c.snapshot, m.case_id, m.chat_id, m.last_pos_post_at, m.near_alerted
       FROM mission_chat m JOIN cases c ON c.id = m.case_id
      WHERE m.status = 'ativa' AND m.created_at > now() - make_interval(hours => $1)
      ORDER BY m.created_at DESC LIMIT 1`,
    [MISSION_TTL_H]
  )
  return rows[0] || null
}

// encerra em silêncio as missões que ninguém fechou (log, sem ruído no grupo)
export async function sweepStaleMissions() {
  try {
    const { rows } = await query(
      `UPDATE mission_chat SET status = 'encerrada'
        WHERE status = 'ativa' AND created_at < now() - make_interval(hours => $1)
        RETURNING case_id`,
      [MISSION_TTL_H]
    )
    if (rows.length) {
      console.log(`[bot] ${rows.length} missão(ões) encerrada(s) por inatividade (>${MISSION_TTL_H}h): caso(s) ${rows.map((r) => r.case_id).join(', ')}`)
    }
  } catch (e) {
    console.error('[bot] sweepStaleMissions:', e.message)
  }
}

// ---------- mensagens compostas ----------
function briefingHtml(caseRow, snap) {
  const L = []
  L.push(`🚁 <b>MISSÃO — Caso ${esc(snap.id || caseRow.id)}</b>`)
  const score = snap.scoreTotal != null ? `Score ${snap.scoreTotal}${snap.band ? ` (${esc(snap.band)})` : ''}` : null
  if (score || snap.recommendation) L.push([score, esc(snap.recommendation)].filter(Boolean).join(' · '))
  if (snap.sceneLabel || snap.scene) {
    const maps = snap.scene ? ` — <a href="${mapsLink(snap.scene)}">Maps</a>` : ''
    L.push(`📍 <b>Cena</b>: ${esc(snap.sceneLabel || 'ponto marcado')}${maps}`)
  }
  const mp = meetPoint(snap)
  if (mp) {
    L.push(`🤝 <b>Ponto de encontro</b>: ${esc(mp.name)} — <a href="${mapsLink(mp)}">abrir no Maps</a>`)
    L.push(`✈️ <code>${fmtDDM(mp)}</code>`)
  }
  if (snap.hospitalName) {
    L.push(`🏥 <b>Destino</b>: ${esc(snap.hospitalName)}${snap.landingName ? ` — pouso no ${esc(snap.landingName)} + transbordo` : ''}`)
  }
  if (snap.mission?.airTotal != null) {
    const g = snap.mission.groundTotal != null ? ` · terrestre ~${Math.round(snap.mission.groundTotal)} min` : ''
    L.push(`⏱️ Aéreo ~${Math.round(snap.mission.airTotal)} min${g}`)
  }
  L.push('')
  L.push('⚠️ <i>Sem dados pessoais do paciente neste grupo. Confirmem leitura com 👍.</i>')
  return L.join('\n')
}

const LZ_PREP_HTML = [
  '🚑 <b>Equipe na cena — preparar o ponto de encontro</b>',
  '1. Pessoas e veículos a 50 m',
  '2. Nada solto na área (lençóis, isopor, cones voam)',
  '3. Confirmar que não há fios SOBRE a área',
  '4. Na chegada do heli: de costas para o vento, braços em Y',
].join('\n')

const HANDOVER_HTML = [
  '🩺 <b>Passagem do caso</b> (médico da ambulância → médico do heli):',
  'peso aproximado · estabilidade/IOT · acessos · medicações em curso.',
  'Já foi feita?',
].join('\n')

// ---------- ações públicas (chamadas pelo index.js) ----------
// aciona o grupo: briefing + preparação da LZ + cobrança da passagem
export async function notifyMission(caseRow, snap, user) {
  const chatId = await boundChat()
  if (!chatId) throw new Error('grupo não vinculado — adicione o bot ao grupo e envie /vincular <código>')
  // o GOA é uma aeronave só: abrir uma missão fecha qualquer outra ainda
  // aberta, para o rastreamento nunca mirar o ponto de encontro errado
  await query(`UPDATE mission_chat SET status = 'encerrada' WHERE status = 'ativa' AND case_id <> $1`, [caseRow.id])
  await query(
    `INSERT INTO mission_chat (case_id, chat_id, created_by) VALUES ($1,$2,$3)
     ON CONFLICT (case_id) DO UPDATE SET
       status = 'ativa', chat_id = EXCLUDED.chat_id, created_at = now(),
       last_pos_post_at = NULL, near_alerted = FALSE`,
    [caseRow.id, chatId, user?.id || null]
  )
  await send(chatId, briefingHtml(caseRow, snap))
  if (meetPoint(snap)) {
    await send(chatId, LZ_PREP_HTML, {
      reply_markup: { inline_keyboard: [[{ text: '✅ LZ SEGURA', callback_data: `lz:${caseRow.id}` }]] },
    })
  }
  await send(chatId, HANDOVER_HTML, {
    reply_markup: { inline_keyboard: [[{ text: '✅ Passagem feita', callback_data: `pass:${caseRow.id}` }]] },
  })
  // horários já marcados antes do acionamento do grupo entram no briefing
  const marked = MILESTONES.filter((m) => snap.events?.[m.id])
  if (marked.length) {
    await send(chatId, marked.map((m) => `🕐 <b>${m.label}</b> — ${hhmm(snap.events[m.id])}`).join('\n'))
  }
}

// eco de cada horário novo/ajustado marcado no app (comandante/regulação)
export async function postMilestones(caseId, changed, byName) {
  const { rows } = await query(`SELECT chat_id, status FROM mission_chat WHERE case_id = $1`, [caseId])
  const mc = rows[0]
  if (!mc || mc.status !== 'ativa') return
  for (const { id, ts, edited } of changed) {
    const label = MILESTONE_BY_ID[id] || id
    await send(mc.chat_id, `🕐 <b>${label}</b> — ${hhmm(ts)}${edited ? ' (corrigido)' : ''}${byName ? ` · por ${esc(byName)}` : ''}`)
  }
  // aeronave liberada encerra a missão no grupo com o resumo dos tempos
  if (changed.some((c) => c.id === 'livre')) await closeMission(caseId)
}

async function closeMission(caseId) {
  const { rows } = await query(
    `SELECT m.chat_id, c.snapshot FROM mission_chat m JOIN cases c ON c.id = m.case_id WHERE m.case_id = $1`,
    [caseId]
  )
  if (!rows[0]) return
  const snap = rows[0].snapshot || {}
  const lines = MILESTONES.filter((m) => snap.events?.[m.id]).map((m) => `• ${m.label}: <b>${hhmm(snap.events[m.id])}</b>`)
  await send(rows[0].chat_id, `✅ <b>Missão encerrada — Caso ${esc(snap.id || caseId)}</b>\n${lines.join('\n')}`)
  await query(`UPDATE mission_chat SET status = 'encerrada' WHERE case_id = $1`, [caseId])
}

// ---------- ETE em deslocamento (posição do rastreamento) ----------
// fala só quando relevante: em voo (GS>40, dado fresco), a cada 5 min,
// e um único alerta de "~2 min do encontro".
const POS_FRESH_MS = 90_000
const POS_CADENCE_MS = 5 * 60_000

export async function enrouteTick() {
  try {
    const { rows: pos } = await query(
      `SELECT lat, lon, gs_kmh, reported_at FROM aircraft_position WHERE aircraft_id = 'goa'`
    )
    const p = pos[0]
    if (!p || Date.now() - new Date(p.reported_at).getTime() > POS_FRESH_MS) return
    if (!(p.gs_kmh > 40)) return

    const m = await currentMission()
    if (!m) return
    const mp = meetPoint(m.snapshot)
    if (!mp) return

    const distKm = haversineKm(p, mp)
    if (distKm > MAX_ENROUTE_KM) return
    const eteMin = (distKm / p.gs_kmh) * 60
    const near = eteMin <= 2 || distKm <= 4

    if (near && !m.near_alerted) {
      await send(m.chat_id, `🚁 <b>GOA a ~${Math.max(1, Math.round(eteMin))} min do ponto de encontro</b> — LZ pronta e isolada?`)
      await query(`UPDATE mission_chat SET near_alerted = TRUE, last_pos_post_at = now() WHERE case_id = $1`, [m.case_id])
    } else if (!near && (!m.last_pos_post_at || Date.now() - new Date(m.last_pos_post_at).getTime() > POS_CADENCE_MS)) {
      await send(m.chat_id, `🚁 GOA em deslocamento — ${distKm < 10 ? distKm.toFixed(1) : Math.round(distKm)} km do encontro, ETE ~${Math.max(1, Math.round(eteMin))} min`)
      await query(`UPDATE mission_chat SET last_pos_post_at = now() WHERE case_id = $1`, [m.case_id])
    }
  } catch (e) {
    console.error('[bot] enrouteTick:', e.message)
  }
}

// ---------- comandos e botões no grupo (long polling) ----------
async function onUpdate(u) {
  const msg = u.message
  if (msg?.text) {
    const [cmd, arg] = msg.text.trim().split(/\s+/)
    const bare = cmd.split('@')[0] // /vincular@NomeDoBot
    if (bare === '/vincular') {
      if (!LINK_CODE || arg !== LINK_CODE) {
        await send(msg.chat.id, '❌ Código inválido. Use <code>/vincular &lt;código&gt;</code> (o código está no servidor, BOT_LINK_CODE).')
        return
      }
      await query(
        `INSERT INTO bot_chat (id, chat_id, title) VALUES (1, $1, $2)
         ON CONFLICT (id) DO UPDATE SET chat_id = EXCLUDED.chat_id, title = EXCLUDED.title, linked_at = now()`,
        [msg.chat.id, msg.chat.title || null]
      )
      await send(msg.chat.id, '✅ Grupo vinculado ao SkyRescue. Os briefings de missão chegam aqui.')
    } else if (bare === '/caso') {
      const m = await currentMission()
      if (!m) await send(msg.chat.id, 'Nenhuma missão ativa no momento.')
      else await send(msg.chat.id, briefingHtml(m, m.snapshot || {}))
    }
    return
  }
  const cb = u.callback_query
  if (cb?.data) {
    const [kind, caseId] = cb.data.split(':')
    const who = [cb.from?.first_name, cb.from?.last_name].filter(Boolean).join(' ') || cb.from?.username || 'alguém'
    const col = kind === 'pass' ? 'handover' : kind === 'lz' ? 'lz_ready' : null
    if (col) {
      await query(`UPDATE mission_chat SET ${col}_at = now(), ${col}_by = $2 WHERE case_id = $1`, [caseId, who])
      const label = kind === 'pass' ? 'Passagem do caso confirmada' : 'LZ segura confirmada'
      await send(cb.message.chat.id, `✅ <b>${label}</b> — por ${esc(who)} às ${hhmm(Date.now())}`)
    }
    await tg('answerCallbackQuery', { callback_query_id: cb.id })
  }
}

async function pollLoop() {
  let offset = 0
  for (;;) {
    try {
      const data = await tg('getUpdates', { timeout: 25, offset, allowed_updates: ['message', 'callback_query'] })
      for (const u of data.result || []) {
        offset = u.update_id + 1
        await onUpdate(u).catch((e) => console.error('[bot] update:', e.message))
      }
    } catch (e) {
      console.error('[bot] poll:', e.message)
      await new Promise((r) => setTimeout(r, 5000))
    }
  }
}

export function startBot() {
  if (dry) {
    console.log('[bot] TELEGRAM_BOT_TOKEN ausente — modo dry-run (mensagens no console, sem polling)')
  } else {
    pollLoop()
    console.log('[bot] Telegram ativo (long polling)')
  }
  sweepStaleMissions() // limpa o que ficou aberto enquanto o serviço esteve fora
  setInterval(enrouteTick, 60_000).unref()
  setInterval(sweepStaleMissions, 15 * 60_000).unref()
}
