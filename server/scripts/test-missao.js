// Reproduz o bug de produção (missão de 14/07 ainda 'ativa' em 21/07) e
// verifica cada uma das três defesas. Roda contra skyrescue_dev, em dry-run
// (sem TELEGRAM_BOT_TOKEN as mensagens só vão para o console).
import { query, pool } from '../src/db.js'
import { currentMission, sweepStaleMissions, notifyMission, enrouteTick } from '../src/telegram.js'

let falhas = 0
const ok = (nome, cond, detalhe = '') => {
  console.log(`${cond ? '  OK  ' : ' FALHA'} ${nome}${detalhe ? ` — ${detalhe}` : ''}`)
  if (!cond) falhas++
}

const CENA = { lat: -12.9714, lon: -38.5014 }            // Salvador
const LONGE = { lat: -16.3400, lon: -39.0700 }           // Porto Seguro, ~430 km

async function mkCase(ref, snap) {
  const { rows } = await query(
    `INSERT INTO cases (case_ref, snapshot) VALUES ($1,$2) RETURNING id`,
    [ref, snap]
  )
  return rows[0].id
}

async function main() {
  await query(`INSERT INTO bot_chat (id, chat_id, title) VALUES (1, -1, 'grupo de teste')
               ON CONFLICT (id) DO UPDATE SET chat_id = -1`)

  const antigo = await mkCase('teste-antigo', { id: 'teste-antigo', scene: CENA, sceneLabel: 'cena antiga' })
  const novo = await mkCase('teste-novo', { id: 'teste-novo', scene: CENA, sceneLabel: 'cena de agora' })

  console.log('\n--- cenário: missão aberta há 7 dias que ninguém encerrou ---')
  await query(
    `INSERT INTO mission_chat (case_id, chat_id, status, created_at)
     VALUES ($1, -1, 'ativa', now() - interval '7 days')
     ON CONFLICT (case_id) DO UPDATE SET status='ativa', created_at = now() - interval '7 days'`,
    [antigo]
  )

  // defesa 1: TTL na consulta — vale mesmo sem a varredura ter rodado
  const m1 = await currentMission()
  ok('TTL: missão de 7 dias não é a missão corrente (/caso responde "nenhuma")', m1 === null,
    m1 ? `retornou caso ${m1.case_id}` : '')

  // e o registro continua 'ativa' no banco — a defesa 1 não depende de escrita
  const st = await query(`SELECT status FROM mission_chat WHERE case_id = $1`, [antigo])
  ok('TTL é só leitura (não depende da varredura ter escrito)', st.rows[0].status === 'ativa')

  // defesa 2: varredura encerra a órfã, para não persistir
  await sweepStaleMissions()
  const st2 = await query(`SELECT status FROM mission_chat WHERE case_id = $1`, [antigo])
  ok('varredura encerrou a missão órfã', st2.rows[0].status === 'encerrada', `status=${st2.rows[0].status}`)

  console.log('\n--- cenário: missão recente órfã + acionamento de uma nova ---')
  await query(
    `INSERT INTO mission_chat (case_id, chat_id, status, created_at)
     VALUES ($1, -1, 'ativa', now() - interval '2 hours')
     ON CONFLICT (case_id) DO UPDATE SET status='ativa', created_at = now() - interval '2 hours'`,
    [antigo]
  )
  const m2 = await currentMission()
  ok('missão de 2 h ainda é válida (TTL não é agressivo demais)', m2?.case_id === String(antigo) || m2?.case_id === antigo,
    `retornou ${m2?.case_id}`)

  // defesa 3: acionar uma missão nova fecha a anterior
  const caseRow = { id: novo }
  await notifyMission(caseRow, { id: 'teste-novo', scene: CENA, sceneLabel: 'cena de agora' }, { id: null })
  const st3 = await query(`SELECT status FROM mission_chat WHERE case_id = $1`, [antigo])
  ok('acionar missão nova encerrou a anterior', st3.rows[0].status === 'encerrada', `status=${st3.rows[0].status}`)
  const m3 = await currentMission()
  ok('a missão corrente passou a ser a nova', String(m3?.case_id) === String(novo), `retornou ${m3?.case_id}`)

  console.log('\n--- cenário: aeronave voando longe demais para ser desta missão ---')
  await query(
    `INSERT INTO aircraft_position (aircraft_id, lat, lon, gs_kmh, reported_at)
     VALUES ('goa', $1, $2, 220, now())
     ON CONFLICT (aircraft_id) DO UPDATE SET lat=EXCLUDED.lat, lon=EXCLUDED.lon,
       gs_kmh=EXCLUDED.gs_kmh, reported_at=now()`,
    [LONGE.lat, LONGE.lon]
  )
  console.log('  (qualquer mensagem [bot dry-run] abaixo é falha do teste)')
  await enrouteTick()
  const pos = await query(`SELECT last_pos_post_at FROM mission_chat WHERE case_id = $1`, [novo])
  ok('a >250 km o bot não posta ETE', pos.rows[0].last_pos_post_at === null)

  console.log('\n--- cenário: aeronave em voo, perto: aí SIM deve falar ---')
  await query(
    `UPDATE aircraft_position SET lat=$1, lon=$2, gs_kmh=200, reported_at=now() WHERE aircraft_id='goa'`,
    [-12.75, -38.40] // ~30 km da cena
  )
  await enrouteTick()
  const pos2 = await query(`SELECT last_pos_post_at FROM mission_chat WHERE case_id = $1`, [novo])
  ok('em voo e perto, o aviso de deslocamento sai', pos2.rows[0].last_pos_post_at !== null)

  // limpeza
  await query(`DELETE FROM cases WHERE id = ANY($1)`, [[antigo, novo]])
  await query(`DELETE FROM aircraft_position WHERE aircraft_id = 'goa'`)
  await pool.end()

  console.log(`\n${falhas === 0 ? 'TODOS OS TESTES PASSARAM' : `${falhas} TESTE(S) FALHARAM`}`)
  process.exit(falhas === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
