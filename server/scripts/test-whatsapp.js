// Canal WhatsApp: tradução HTML->WhatsApp e o despacho das palavras nos mesmos
// handlers do Telegram. Roda contra skyrescue_dev em dry-run (sem WA_BRIDGE_URL).
import { query, pool } from '../src/db.js'
import { htmlToWa, onWaMessage, boundWa } from '../src/whatsapp.js'
import { notifyMission } from '../src/telegram.js'

let falhas = 0
const ok = (nome, cond, detalhe = '') => {
  console.log(`${cond ? '  OK  ' : ' FALHA'} ${nome}${detalhe ? ` — ${detalhe}` : ''}`)
  if (!cond) falhas++
}
function capturar() {
  const orig = console.log
  const msgs = []
  console.log = (...a) => { msgs.push(a.join(' ')) }
  return { msgs, parar: () => { console.log = orig } }
}
async function fala(text, chat = '5571999990000-1@g.us') {
  const cap = capturar()
  try { await onWaMessage({ chat, sender: '5571988880000@s.whatsapp.net', name: 'Tester', text }) } finally { cap.parar() }
  return cap.msgs.join('\n')
}

async function main() {
  console.log('=== tradução de formatação ===')
  const t = htmlToWa('<b>x</b> <i>y</i> <code>z</code> <a href="https://m/1">Maps</a> &lt;3 &amp;')
  ok('negrito/itálico/mono/link/entidades', t === '*x* _y_ `z` Maps: https://m/1 <3 &', t)

  console.log('\n=== vínculo ===')
  await query(`DELETE FROM bot_chat WHERE id = 1 AND chat_id = '-1'`) // sobra de teste anterior interrompido
  process.env.BOT_LINK_CODE = process.env.BOT_LINK_CODE || 'abc'
  ok('código errado recusa', (await fala('vincular nope')).includes('Código inválido'))
  ok('código certo vincula', (await fala(`vincular ${process.env.BOT_LINK_CODE}`)).includes('vinculado'))
  ok('bot_chat id=2 gravado', (await boundWa()) === '5571999990000-1@g.us')

  console.log('\n=== comandos ===')
  await query(`UPDATE mission_chat SET status = 'encerrada'`)
  ok('caso sem missão', (await fala('caso')).includes('Nenhuma missão ativa'))
  ok('/caso com barra também', (await fala('/caso')).includes('Nenhuma missão ativa'))
  ok('ajuda lista as palavras', (await fala('ajuda')).includes('*tempos*'))
  ok('conversa solta no grupo fica em silêncio', (await fala('bom dia pessoal')) === '')
  ok('conversa solta no privado recebe o menu', (await fala('bom dia', '5571988880000@s.whatsapp.net')).includes('SkyRescue'))

  const { rows } = await query(
    `INSERT INTO cases (case_ref, snapshot) VALUES ('teste-wa', $1) RETURNING id`,
    [{ id: 'teste-wa', scene: { lat: -12.97, lon: -38.5 }, sceneLabel: 'Av. Paralela', events: { decisao: Date.now() } }]
  )
  const caseId = rows[0].id
  const cap = capturar()
  await notifyMission({ id: caseId }, { id: 'teste-wa', scene: { lat: -12.97, lon: -38.5 }, sceneLabel: 'Av. Paralela', events: { decisao: Date.now() } }, { id: null })
  cap.parar()
  const briefing = cap.msgs.join('\n')
  ok('acionamento chega no WhatsApp', briefing.includes('[wa dry-run → 5571999990000-1@g.us]') && briefing.includes('*MISSÃO — Caso teste-wa*'), briefing.slice(0, 80))
  ok('acionamento sem grupo Telegram não tenta o Telegram', !briefing.includes('[bot dry-run'))

  ok('caso com missão traz briefing', (await fala('caso')).includes('MISSÃO — Caso teste-wa'))
  ok('lz ok confirma', (await fala('lz ok')).includes('LZ segura confirmada'))
  ok('passagem feita confirma', (await fala('passagem feita')).includes('Passagem do caso confirmada'))
  const { rows: mc } = await query('SELECT lz_ready_by, handover_by FROM mission_chat WHERE case_id = $1', [caseId])
  ok('confirmações gravadas com quem confirmou', mc[0]?.lz_ready_by === 'Tester' && mc[0]?.handover_by === 'Tester')

  await query('DELETE FROM cases WHERE id = $1', [caseId])
  await query('DELETE FROM bot_chat WHERE id = 2')
  await pool.end()
  console.log(`\n${falhas === 0 ? 'TODOS OS TESTES PASSARAM' : `${falhas} TESTE(S) FALHARAM`}`)
  process.exit(falhas === 0 ? 0 : 1)
}
main().catch((e) => { console.error(e); process.exit(1) })
