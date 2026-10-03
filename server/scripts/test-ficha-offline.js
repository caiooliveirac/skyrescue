// Teste de integração (HTTP) da sincronização offline: criação idempotente de
// caso, fusão de três pontas da ficha, divergência e resolução.
//
// Roda contra uma API de DESENVOLVIMENTO já no ar (banco skyrescue_dev), nunca
// produção. Dados fictícios; o caso é apagado no fim.
//   BASE=http://127.0.0.1:4912 TEST_USER=... TEST_PASS=... node scripts/test-ficha-offline.js
const BASE = process.env.BASE || 'http://127.0.0.1:3012'
const USER = process.env.TEST_USER
const PASS = process.env.TEST_PASS

let falhas = 0
const ok = (nome, cond, detalhe = '') => {
  console.log(`${cond ? '  OK  ' : ' FALHA'} ${nome}${detalhe ? ` — ${detalhe}` : ''}`)
  if (!cond) falhas++
}

let cookie = ''
async function req(method, path, body) {
  const res = await fetch(BASE + '/api' + path, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const sc = res.headers.get('set-cookie')
  if (sc) cookie = sc.split(';')[0]
  let data = null
  try { data = await res.json() } catch { /* sem corpo */ }
  return { status: res.status, data }
}

async function main() {
  if (!USER || !PASS) { console.error('defina TEST_USER e TEST_PASS'); process.exit(2) }
  const login = await req('POST', '/auth/login', { username: USER, password: PASS })
  ok('login', login.status === 200)

  // ---- criação idempotente ----
  const opCaso = 'teste-op-' + Date.now()
  const snap = { sceneLabel: 'TESTE AUTOMATIZADO — apagar', notes: 'caso fictício' }
  const c1 = await req('POST', '/cases', { snapshot: snap, opId: opCaso })
  const c2 = await req('POST', '/cases', { snapshot: snap, opId: opCaso })
  const id = c1.data?.id
  ok('POST /cases cria', c1.status === 201 && id != null)
  ok('POST /cases repetido com o mesmo opId devolve o mesmo caso', c2.status === 200 && String(c2.data?.id) === String(id) && c2.data?.duplicate === true)

  // ---- cliente antigo ----
  const g0 = await req('GET', `/cases/${id}/patient`)
  ok('caso sem ficha: versão 0', g0.data?.version === 0 && g0.data?.patient === null)
  const leg = await req('PATCH', `/cases/${id}/patient`, { fields: { nome: 'Paciente Fictício', fc: '80' } })
  ok('PATCH no formato antigo continua gravando', leg.status === 200 && leg.data?.ok && leg.data?.updatedAt && leg.data?.version === 1)

  // ---- dois aparelhos partindo da versão 1 ----
  const base = { fc: '80', pa: '' }
  const a = await req('PATCH', `/cases/${id}/patient`, { changes: { fc: '110' }, base, baseVersion: 1, opId: 'a-' + opCaso })
  ok('aparelho A (versão em dia): aplica', a.data?.version === 2 && a.data?.fields?.fc === '110' && a.data?.conflicts?.length === 0)

  const corpoB = { changes: { fc: '130', pa: '90x60' }, base, baseVersion: 1, opId: 'b-' + opCaso, clientTs: Date.now() - 60000 }
  const b = await req('PATCH', `/cases/${id}/patient`, corpoB)
  ok('aparelho B (versão velha): campo em disputa vira divergência', b.status === 200 && b.data?.conflicts?.join() === 'fc' && b.data?.pendingConflicts === 1)
  ok('aparelho B: resposta devolve o valor do servidor no campo em disputa', b.data?.fields?.fc === '110')
  ok('aparelho B: campo sem disputa entra', b.data?.fields?.pa === '90x60' && b.data?.version === 3)

  const b2 = await req('PATCH', `/cases/${id}/patient`, corpoB)
  ok('reenvio do mesmo opId: não duplica divergência nem versão', b2.data?.duplicate === true && b2.data?.pendingConflicts === 1 && b2.data?.version === 3)

  const g1 = await req('GET', `/cases/${id}/patient`)
  ok('nenhum valor some: servidor mantém o dele', g1.data?.patient?.fc === '110' && g1.data?.patient?.nome === 'Paciente Fictício')

  const live = await req('GET', `/cases/${id}/live`)
  ok('poll leva só a contagem', live.data?.patientConflicts === 1 && !JSON.stringify(live.data).includes('130'))
  const lista = await req('GET', '/cases')
  ok('listagem não carrega valores em disputa', !JSON.stringify(lista.data).includes('Paciente Fictício'))

  // ---- divergências ----
  const cf = await req('GET', `/cases/${id}/patient/conflicts`)
  const d = cf.data?.conflicts?.[0]
  ok('lista de divergências traz as duas pontas', cf.data?.conflicts?.length === 1 && d?.field === 'fc' && d?.serverValue === '110' && d?.clientValue === '130' && d?.baseValue === '80')
  ok('divergência diz quem e quando', Boolean(d?.clientBy && d?.clientAt && d?.serverAt))

  cookie = ''
  const anon = await req('POST', `/cases/${id}/patient/conflicts/${d?.id}/resolve`, { chosen: 'client' })
  ok('resolver exige login', anon.status === 401)
  await req('POST', '/auth/login', { username: USER, password: PASS })

  const ruim = await req('POST', `/cases/${id}/patient/conflicts/${d?.id}/resolve`, { chosen: 'tanto faz' })
  ok('escolha inválida é recusada', ruim.status === 400)
  const rs = await req('POST', `/cases/${id}/patient/conflicts/${d?.id}/resolve`, { chosen: 'client' })
  ok('resolver pelo aparelho', rs.status === 200 && rs.data?.pendingConflicts === 0)
  const g2 = await req('GET', `/cases/${id}/patient`)
  ok('valor escolhido entra na ficha e a versão sobe', g2.data?.patient?.fc === '130' && g2.data?.version === 4)
  const rs2 = await req('POST', `/cases/${id}/patient/conflicts/${d?.id}/resolve`, { chosen: 'server' })
  ok('resolver duas vezes é recusado', rs2.status === 409)

  // escolher o servidor mantém o valor
  await req('PATCH', `/cases/${id}/patient`, { changes: { gcs: '15' }, base: { gcs: '' }, baseVersion: 4, opId: 'c-' + opCaso })
  const e = await req('PATCH', `/cases/${id}/patient`, { changes: { gcs: '9' }, base: { gcs: '' }, baseVersion: 4, opId: 'd-' + opCaso })
  const cf2 = await req('GET', `/cases/${id}/patient/conflicts`)
  const rs3 = await req('POST', `/cases/${id}/patient/conflicts/${cf2.data?.conflicts?.[0]?.id}/resolve`, { chosen: 'server' })
  const g3 = await req('GET', `/cases/${id}/patient`)
  ok('resolver pelo servidor mantém o valor', e.data?.conflicts?.join() === 'gcs' && rs3.status === 200 && g3.data?.patient?.gcs === '15')

  // ---- limpeza ----
  const del = await req('DELETE', `/cases/${id}`)
  const cf3 = await req('GET', `/cases/${id}/patient/conflicts`)
  ok('apagar o caso leva ficha e divergências', del.status === 200 && cf3.data?.conflicts?.length === 0)

  console.log(falhas ? `\n${falhas} falha(s)` : '\ntudo certo')
  process.exit(falhas ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
