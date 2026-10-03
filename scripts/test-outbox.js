// Teste da caixa de saída (src/lib/outbox.js) contra uma API de
// DESENVOLVIMENTO — nunca produção. Roda em Node, sem navegador: a rede é um
// fetch que este script liga, desliga e faz "perder a resposta".
// Dados fictícios; os casos criados são apagados no fim.
//   BASE=http://127.0.0.1:4912 TEST_USER=... TEST_PASS=... node scripts/test-outbox.js
const BASE = process.env.BASE
const USER = process.env.TEST_USER
const PASS = process.env.TEST_PASS
if (!BASE || !USER || !PASS) { console.error('defina BASE, TEST_USER e TEST_PASS'); process.exit(2) }

// ---- navegador de mentira: localStorage e rede controlável ----
const mem = new Map()
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  key: (i) => [...mem.keys()][i] ?? null,
  get length() { return mem.size },
}
const rede = { fora: false, perderResposta: 0, cookie: '' }
const fetchReal = globalThis.fetch
globalThis.fetch = async (url, opts = {}) => {
  if (rede.fora) throw new TypeError('sem rede')
  const res = await fetchReal(BASE + url, { ...opts, headers: { ...(opts.headers || {}), cookie: rede.cookie } })
  const sc = res.headers.get('set-cookie')
  if (sc) rede.cookie = sc.split(';')[0]
  // o pedido CHEGOU ao servidor; só a resposta é que não volta
  if (rede.perderResposta > 0 && opts.method !== 'GET') { rede.perderResposta--; throw new TypeError('resposta perdida') }
  return res
}

const outbox = await import('../src/lib/outbox.js')
const { api } = await import('../src/lib/backend.js')
const { savePatient, readMirror } = await import('../src/lib/patient.js')

let falhas = 0
const ok = (nome, cond, detalhe = '') => {
  console.log(`${cond ? '  OK  ' : ' FALHA'} ${nome}${detalhe ? ` — ${detalhe}` : ''}`)
  if (!cond) falhas++
}
const dorme = (ms) => new Promise((r) => setTimeout(r, ms))
// espera a fila parar (cada enfileiramento dispara um envio por conta própria)
const assenta = async () => { for (let i = 0; i < 200; i++) { await dorme(25); if (!outbox.status(uid).sending) return } }
const volta = async () => { rede.fora = false; outbox.netOk(); await outbox.flush(); await assenta() }

const resultados = []
outbox.onResult((ev) => resultados.push(ev))

const { user } = await api.login(USER, PASS)
const uid = user.id
const marca = 'TESTE CAIXA DE SAÍDA ' + Date.now()
const meus = async () => (await api.listCases()).cases.filter((c) => c.scene_label === marca)

// ---------- 1. tudo criado sem rede ----------
rede.fora = true
outbox.netDown()
const opId = outbox.newOpId()
const tmp = outbox.enqueueCaseCreate(uid, { sceneLabel: marca, notes: 'caso fictício' }, opId, 'teste')
outbox.setPatientPatch(uid, tmp, { nome: 'Paciente Fictício', fc: '80' }, {}, 0, 'teste')
outbox.sendEvent(uid, tmp, 'decolagem', 1700000000000)
savePatient(uid, tmp, { nome: 'Paciente Fictício', fc: '80' }, null, 0)
await assenta()
let st = outbox.status(uid)
ok('sem rede: 3 itens guardados, nada enviado', st.pending === 3 && st.online === false && resultados.length === 0)
ok('sem rede: id provisório', outbox.isTmp(tmp) && outbox.resolveId(tmp) === tmp)
ok('sem rede: marco consta como pendente', outbox.pendingEvents(tmp).has('decolagem'))

// ---------- 2. a rede volta ----------
await volta()
st = outbox.status(uid)
const id = outbox.resolveId(tmp)
ok('rede voltou: fila esvaziou sozinha', st.pending === 0 && st.online === true)
ok('id provisório virou id real', !outbox.isTmp(id) && resultados[0]?.type === 'case.create' && String(resultados[0].id) === String(id))
ok('subiu na ordem: caso, ficha, horário', resultados.map((r) => r.type).join() === 'case.create,patient.patch,event.save')
const ficha = await api.getPatient(id)
ok('ficha chegou ao caso real', ficha.patient?.nome === 'Paciente Fictício' && ficha.patient?.fc === '80' && ficha.version === 1)
const caso = await api.getCase(id)
ok('horário chegou com o carimbo original', Number(caso.case.snapshot?.events?.decolagem) === 1700000000000)
ok('espelho da ficha mudou de gaveta', readMirror(uid, id)?.patient?.fc === '80' && readMirror(uid, tmp) === null)
ok('uma vez só: um caso no servidor', (await meus()).length === 1)

// ---------- 3. resposta perdida: reenvio não duplica ----------
rede.perderResposta = 1
const tmp2 = outbox.enqueueCaseCreate(uid, { sceneLabel: marca, notes: 'segundo' }, outbox.newOpId(), 'teste')
await assenta()
ok('resposta perdida: item continua na fila', outbox.status(uid).pending === 1)
await volta()
const id2 = outbox.resolveId(tmp2)
ok('reenvio devolve o MESMO caso (opId)', !outbox.isTmp(id2) && (await meus()).length === 2)

rede.perderResposta = 1
outbox.setPatientPatch(uid, id2, { pa: '120x80' }, { pa: '' }, 0, 'teste')
await assenta()
await volta()
const f2 = await api.getPatient(id2)
ok('ficha com resposta perdida: aplicada uma vez', f2.patient?.pa === '120x80' && f2.version === 1 && outbox.status(uid).pending === 0)

// ---------- 4. divergência ----------
// este aparelho viu fc=80 (versão 1) e ficou sem rede; outro mudou para 110
savePatient(uid, id, { nome: 'Paciente Fictício', fc: '130', pa: '90x60' }, { nome: 'Paciente Fictício', fc: '80', pa: '' }, 1)
await api.syncPatient(id, { changes: { fc: '110' }, base: { fc: '80' }, baseVersion: 1, opId: outbox.newOpId() })
rede.fora = true; outbox.netDown()
outbox.setPatientPatch(uid, id, { fc: '130', pa: '90x60' }, { fc: '80', pa: '' }, 1, 'teste')
await assenta()
ok('edição sem rede fica pendente com a base original', outbox.pendingPatient(id)?.base?.fc === '80')
resultados.length = 0
await volta()
const r = resultados[0]
ok('campo em disputa vira divergência', r?.conflicts?.join() === 'fc' && r?.pendingConflicts === 1)
ok('campo sem disputa entra', r?.fields?.pa === '90x60')
const f3 = await api.getPatient(id)
ok('servidor mantém o valor dele; nada some', f3.patient?.fc === '110' && f3.patient?.pa === '90x60')
const cf = await api.patientConflicts(id)
ok('valor do aparelho guardado na divergência', cf.conflicts?.[0]?.clientValue === '130' && cf.conflicts?.[0]?.serverValue === '110')
const esp = readMirror(uid, id)
ok('espelho adota o servidor no campo em disputa', esp?.patient?.fc === '110' && esp?.base?.fc === '110' && esp?.version === f3.version)

// ---------- 5. sessão vencida: nada sobe sem /auth/me OK ----------
rede.fora = true; outbox.netDown() // derruba a confirmação de sessão guardada
const cookie = rede.cookie
rede.cookie = ''
outbox.sendEvent(uid, id, 'pouso_cena', 1700000100000)
await volta()
st = outbox.status(uid)
ok('sem sessão: item fica e o estado pede login', st.pending === 1 && st.auth === 'needed', JSON.stringify(st))
rede.cookie = cookie
outbox.resetAuth()
await volta()
ok('com sessão de novo: sobe', outbox.status(uid).pending === 0 && outbox.status(uid).auth === null)

// ---------- 6. item de outro usuário não sobe com esta sessão ----------
outbox.sendEvent(uid + 100000, id, 'decolagem2', 1700000200000)
await volta()
ok('item de outro usuário espera o login dele', outbox.status(uid).others === 1 && outbox.status(uid).pending === 0)

// ---------- 7. recusado de vez não trava a fila ----------
outbox.setPatientPatch(uid, 999999999, { fc: '1' }, { fc: '' }, 0, 'teste')
outbox.sendEvent(uid, id, 'pouso_destino', 1700000300000)
await volta()
st = outbox.status(uid)
ok('caso inexistente: item marcado como recusado, o seguinte sobe', st.dead === 1 && st.pending === 0)
outbox.discardDead(uid)
ok('descartar recusados', outbox.status(uid).dead === 0)

// ---------- limpeza ----------
for (const c of await meus()) await api.deleteCase(c.id)
ok('casos de teste apagados', (await meus()).length === 0)

console.log(falhas ? `\n${falhas} falha(s)` : '\ntudo certo')
process.exit(falhas ? 1 : 0)
