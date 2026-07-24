// Reproduz o incidente de 24/07/2026 (caso 107): o médico marcou "Acionamento
// do GOA autorizado", o horário foi gravado e o bot ficou calado no grupo,
// porque abrir a missão dependia de um segundo clique em "Grupo da missão".
// Verifica a regra nova (o marco aciona o grupo) e, principalmente, que ela não
// atropela as defesas contra missão fantasma. Roda contra skyrescue_dev, em
// dry-run (sem TELEGRAM_BOT_TOKEN as mensagens só vão para o console).
import { query, pool } from '../src/db.js'
import { echoMilestones, missionStatus } from '../src/telegram.js'

let falhas = 0
const ok = (nome, cond, detalhe = '') => {
  console.log(`${cond ? '  OK  ' : ' FALHA'} ${nome}${detalhe ? ` — ${detalhe}` : ''}`)
  if (!cond) falhas++
}

// captura o que o bot mandaria, em vez de deixar cair no console
function capturar() {
  const orig = console.log
  const msgs = []
  console.log = (...a) => { msgs.push(a.join(' ')) }
  return { msgs, parar: () => { console.log = orig } }
}
async function marcar(caseId, changed, user = { id: null, full_name: 'Médico de teste' }) {
  const cap = capturar()
  let r, erro = null
  try { r = await echoMilestones(caseId, changed, user) } catch (e) { erro = e } finally { cap.parar() }
  return { r, erro, out: cap.msgs.join('\n') }
}

const CENA = { lat: -12.9714, lon: -38.5014 }
const snap = (ref, extra = {}) => ({ id: ref, scene: CENA, sceneLabel: 'Av. Paralela', hospitalName: 'Hospital do Subúrbio', ...extra })

async function mkCase(ref, s) {
  const { rows } = await query(`INSERT INTO cases (case_ref, snapshot) VALUES ($1,$2) RETURNING id`, [ref, s])
  return rows[0].id
}

async function main() {
  await query(`INSERT INTO bot_chat (id, chat_id, title) VALUES (1, -1, 'grupo de teste')
               ON CONFLICT (id) DO UPDATE SET chat_id = -1`)
  await query(`UPDATE mission_chat SET status = 'encerrada'`)

  console.log('=== o marco do acionamento abre o grupo (o bug de 24/07) ===')
  const ts = Date.now()
  const c1 = await mkCase('teste-acion-1', snap('teste-acion-1', { events: { decisao: ts } }))
  ok('missão não existe antes de marcar', (await missionStatus(c1)) === null)

  const a = await marcar(c1, [{ id: 'decisao', ts, edited: false }])
  ok('marcar "Acionamento autorizado" abre a missão', a.r === 'aberta', `retorno=${a.r}`)
  ok('mission_chat fica ativa', (await missionStatus(c1)) === 'ativa')
  ok('o briefing foi ao grupo', a.out.includes('MISSÃO — Caso teste-acion-1'), a.out.slice(0, 60))
  ok('o horário do acionamento entra no briefing', a.out.includes('Acionamento do GOA autorizado'))
  ok('o briefing não duplica o marco', a.out.split('Acionamento do GOA autorizado').length - 1 === 1)

  console.log('\n=== marcos seguintes: eco normal, sem reabrir nada ===')
  const b = await marcar(c1, [{ id: 'decolagem', ts: ts + 60000, edited: false }])
  ok('marco seguinte só ecoa', b.r === null, `retorno=${b.r}`)
  ok('eco traz o marco e o autor', b.out.includes('Decolagem da base') && b.out.includes('Médico de teste'), b.out.slice(0, 80))
  ok('missão continua ativa', (await missionStatus(c1)) === 'ativa')

  console.log('\n=== acionar um caso novo encerra a missão anterior (uma aeronave só) ===')
  const c2 = await mkCase('teste-acion-2', snap('teste-acion-2', { events: { decisao: ts } }))
  const c = await marcar(c2, [{ id: 'decisao', ts, edited: false }])
  ok('o caso novo abre missão', c.r === 'aberta' && (await missionStatus(c2)) === 'ativa')
  ok('a missão anterior foi encerrada', (await missionStatus(c1)) === 'encerrada')

  console.log('\n=== missão encerrada NÃO ressuscita (defesa da missão fantasma) ===')
  const d = await marcar(c1, [{ id: 'decisao', ts: ts + 120000, edited: true }])
  ok('correção de horário não reabre a missão velha', d.r === null, `retorno=${d.r}`)
  ok('a missão velha continua encerrada', (await missionStatus(c1)) === 'encerrada')
  ok('e o bot não falou dela', !d.out.includes('teste-acion-1'), d.out.slice(0, 80))

  console.log('\n=== "Aeronave liberada" encerra, como antes ===')
  const e = await marcar(c2, [{ id: 'livre', ts: ts + 3600000, edited: false }])
  ok('livre encerra a missão', (await missionStatus(c2)) === 'encerrada', `retorno=${e.r}`)
  ok('encerramento sai com a cronologia', e.out.includes('Missão encerrada'))

  console.log('\n=== sem grupo vinculado, o erro sobe (vira aviso na tela) ===')
  await query(`DELETE FROM bot_chat WHERE id = 1`)
  const c3 = await mkCase('teste-acion-3', snap('teste-acion-3', { events: { decisao: ts } }))
  const f = await marcar(c3, [{ id: 'decisao', ts, edited: false }])
  ok('echoMilestones lança quando o grupo não está vinculado', f.erro != null, f.erro?.message || 'não lançou')
  ok('e nenhuma missão fica pendurada', (await missionStatus(c3)) === null)

  // limpeza (inclusive o vínculo derrubado no último cenário)
  await query(`DELETE FROM cases WHERE case_ref LIKE 'teste-acion-%'`)
  await query(`INSERT INTO bot_chat (id, chat_id, title) VALUES (1, -1, 'grupo de teste')
               ON CONFLICT (id) DO UPDATE SET chat_id = -1`)
  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo certo.')
  await pool.end()
  process.exit(falhas ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
