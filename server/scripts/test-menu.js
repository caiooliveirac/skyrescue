// Comandos do menu do bot: cada um precisa responder algo útil COM missão
// ativa e não quebrar (nem inventar dados) sem missão — que é como o grupo
// passa a maior parte do tempo. Roda contra skyrescue_dev em dry-run.
import { query, pool } from '../src/db.js'
import { HANDLERS, CMDS_GRUPO, notifyMission } from '../src/telegram.js'

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

async function rodar(cmd) {
  const cap = capturar()
  try { await HANDLERS[cmd](-1) } finally { cap.parar() }
  return cap.msgs.join('\n')
}

const CENA = { lat: -12.9714, lon: -38.5014 }

async function main() {
  await query(`INSERT INTO bot_chat (id, chat_id, title) VALUES (1, -1, 'grupo de teste')
               ON CONFLICT (id) DO UPDATE SET chat_id = -1`)

  console.log('=== todo comando do menu tem handler ===')
  for (const c of CMDS_GRUPO) {
    ok(`/${c.command} tem handler`, typeof HANDLERS[c.command] === 'function')
  }

  console.log('\n=== sem missão ativa (estado normal do grupo) ===')
  await query(`UPDATE mission_chat SET status = 'encerrada'`)
  for (const c of CMDS_GRUPO.filter((c) => c.command !== 'ajuda' && c.command !== 'goa')) {
    const out = await rodar(c.command)
    ok(`/${c.command} avisa que não há missão`, out.includes('Nenhuma missão ativa'), out.slice(0, 60))
  }
  const ajuda = await rodar('ajuda')
  ok('/ajuda funciona sem missão (é o menu)', ajuda.includes('SkyRescue'))

  console.log('\n=== com missão ativa ===')
  const { rows } = await query(
    `INSERT INTO cases (case_ref, snapshot) VALUES ('teste-menu', $1) RETURNING id`,
    [{ id: 'teste-menu', scene: CENA, sceneLabel: 'Av. Paralela', hospitalName: 'Hospital do Subúrbio',
       events: { decisao: Date.now() - 900000, decolagem: Date.now() - 600000 } }]
  )
  const caseId = rows[0].id
  const cap0 = capturar()
  await notifyMission({ id: caseId }, { id: 'teste-menu', scene: CENA, sceneLabel: 'Av. Paralela',
    events: { decisao: Date.now() - 900000, decolagem: Date.now() - 600000 } }, { id: null })
  cap0.parar()

  const caso = await rodar('caso')
  ok('/caso traz o briefing da missão', caso.includes('MISSÃO — Caso teste-menu') && caso.includes('Ponto de encontro'))

  const tempos = await rodar('tempos')
  ok('/tempos lista os marcados', tempos.includes('Acionamento do GOA autorizado') && tempos.includes('Decolagem da base'))
  ok('/tempos aponta o próximo marco', tempos.includes('Próximo') && tempos.includes('Pouso na cena'))
  ok('/tempos não inventa marco não marcado', !tempos.includes('• Paciente entregue'))

  const lz = await rodar('lz')
  ok('/lz traz o checklist com as coordenadas do encontro', lz.includes('preparar o ponto de encontro') && lz.includes("12°58.28'S"))

  const passagem = await rodar('passagem')
  ok('/passagem cobra a passagem', passagem.includes('Passagem do caso'))

  console.log('\n=== /goa em cada estado do rastreamento ===')
  await query(`DELETE FROM aircraft_position WHERE aircraft_id = 'goa'`)
  ok('/goa sem rastreamento nenhum', (await rodar('goa')).includes('Sem rastreamento'))

  await query(
    `INSERT INTO aircraft_position (aircraft_id, lat, lon, gs_kmh, reported_at)
     VALUES ('goa', -12.75, -38.40, 200, now() - interval '10 minutes')`
  )
  ok('/goa com sinal velho avisa que está mudo', (await rodar('goa')).includes('Sem sinal'))

  await query(`UPDATE aircraft_position SET reported_at = now() WHERE aircraft_id = 'goa'`)
  const voando = await rodar('goa')
  ok('/goa em voo dá distância e ETE', voando.includes('GOA agora') && voando.includes('ETE'), voando.slice(0, 90))

  await query(`DELETE FROM cases WHERE id = $1`, [caseId])
  await query(`DELETE FROM aircraft_position WHERE aircraft_id = 'goa'`)
  await query(`DELETE FROM bot_chat WHERE chat_id = -1`)
  await pool.end()

  console.log(`\n${falhas === 0 ? 'TODOS OS TESTES PASSARAM' : `${falhas} TESTE(S) FALHARAM`}`)
  process.exit(falhas === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
