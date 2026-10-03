// ------------------------------------------------------------------
// Caixa de saída: tudo o que o aparelho escreve e ainda não chegou ao
// servidor. Substitui as filas avulsas (a antiga lib/eventQueue.js só
// guardava horários): criação de caso, ficha do paciente e horários da
// missão passam por aqui, em ordem, e sobem sozinhos quando há rede.
//
// Item: { opId, seq, at, userId, type, caseId, sending?, dead?, err?, ... }
//   case.create   { snapshot, clientId }   caseId = id provisório 'tmp-…'
//   patient.patch { changes, base, baseVersion, clientId }
//   event.save    { event, ts }
//
// `opId` é a idempotência: o envio é repetido até ter resposta e o servidor
// reconhece a repetição. `base` (ficha) é como o aparelho via cada campo na
// última sincronização — é o que permite ao servidor detectar que os dois
// lados mudaram o mesmo campo (vira divergência; ver server/src/patient-merge.js).
//
// Caso criado sem rede ganha id provisório; quando o servidor devolve o id
// real, os itens seguintes e o espelho da ficha são reescritos.
//
// Nada sobe antes de /api/auth/me responder OK: a sessão offline (main.jsx)
// só vale para trabalhar no aparelho.
//
// Guardado em IndexedDB (dado de paciente fica fora do localStorage, que é
// síncrono e pequeno). O estado em memória é a cópia de trabalho; o poll da
// tela consulta `pendingEvents`/`pendingPatient` de forma síncrona.
// ------------------------------------------------------------------
import { api } from './backend.js'
import { movePatient, ackPatient } from './patient.js'

const DB_NAME = 'skyrescue_outbox'
const STORE = 'items'
const LEGACY_EVT_KEY = 'skyrescue_evt_queue_v1' // fila antiga de horários
const FALLBACK_KEY = 'skyrescue_outbox_fallback_v1' // navegador sem IndexedDB
const IDMAP_KEY = 'skyrescue_idmap_v1' // { 'tmp-…': id real }
const RETRY_MS = 20_000

let items = []
let idb = null
let flushing = false
let denovo = false
let timer = null
let authed = null // usuário confirmado por /auth/me nesta janela de rede
const state = { online: typeof navigator === 'undefined' ? true : navigator.onLine !== false, auth: null }

const subs = new Set()
const resultSubs = new Set()
const notify = () => subs.forEach((f) => { try { f() } catch (e) { /* tela */ } })
const emit = (ev) => resultSubs.forEach((f) => { try { f(ev) } catch (e) { console.warn('outbox result:', e?.message || e) } })
export const subscribe = (f) => { subs.add(f); return () => subs.delete(f) }
export const onResult = (f) => { resultSubs.add(f); return () => resultSubs.delete(f) }

export const newOpId = () =>
  (globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`)
export const isTmp = (id) => typeof id === 'string' && id.startsWith('tmp-')
// sem `status` o pedido nem chegou ao servidor; 5xx/429 passam sozinhos
export const transient = (e) => !e?.status || e.status >= 500 || e.status === 429

// ---------------- persistência ----------------
const idbReq = (r) => new Promise((ok, fail) => { r.onsuccess = () => ok(r.result); r.onerror = () => fail(r.error) })
function openDb() {
  return new Promise((ok, fail) => {
    const r = indexedDB.open(DB_NAME, 1)
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'opId' })
    r.onsuccess = () => ok(r.result)
    r.onerror = () => fail(r.error)
    r.onblocked = () => fail(new Error('IndexedDB bloqueado'))
  })
}
const stored = ({ sending, ...it }) => it // `sending` é só de memória
const store = () => idb.transaction(STORE, 'readwrite').objectStore(STORE)
const fallback = () => { try { localStorage.setItem(FALLBACK_KEY, JSON.stringify(items.map(stored))) } catch (e) { /* só memória */ } }
function persist(it) {
  if (!idb) return fallback()
  try { idbReq(store().put(stored(it))).catch(fallback) } catch (e) { fallback() }
}
function unpersist(opId) {
  if (!idb) return fallback()
  try { idbReq(store().delete(opId)).catch(fallback) } catch (e) { fallback() }
}

const readIdMap = () => { try { return JSON.parse(localStorage.getItem(IDMAP_KEY)) || {} } catch (e) { return {} } }
export const resolveId = (id) => (isTmp(id) ? readIdMap()[id] ?? id : id)

let seq = 0
const add = (it) => {
  const novo = { opId: newOpId(), seq: ++seq, at: Date.now(), ...it }
  items.push(novo)
  persist(novo)
  return novo
}
const remove = (it) => { items = items.filter((x) => x !== it); unpersist(it.opId) }

async function load() {
  try { idb = await openDb() } catch (e) { idb = null }
  let lidos = []
  try {
    if (idb) lidos = await idbReq(idb.transaction(STORE).objectStore(STORE).getAll())
    // o que tiver ficado no plano B (IndexedDB falhou numa sessão anterior) entra junto
    const plano = JSON.parse(localStorage.getItem(FALLBACK_KEY)) || []
    lidos = lidos.concat(plano.filter((p) => !lidos.some((x) => x.opId === p.opId)))
  } catch (e) { /* segue com o que deu para ler */ }
  lidos.sort((a, b) => a.seq - b.seq)
  // o que entrou enquanto o banco abria vai para o fim, renumerado
  const chegaram = items
  seq = lidos.reduce((m, it) => Math.max(m, it.seq || 0), 0)
  chegaram.forEach((it) => { it.seq = ++seq })
  items = lidos.concat(chegaram)
  if (idb) {
    items.forEach(persist)
    try { localStorage.removeItem(FALLBACK_KEY) } catch (e) { /* ok */ }
  }
  // horários que estavam na fila antiga (versão anterior do app): entram aqui
  // sem perder nenhum, e só então a chave antiga some
  try {
    const antigos = JSON.parse(localStorage.getItem(LEGACY_EVT_KEY)) || []
    for (const a of antigos) {
      if (a && a.caseId != null && a.event) add({ type: 'event.save', userId: null, caseId: a.caseId, event: a.event, ts: a.ts })
    }
    localStorage.removeItem(LEGACY_EVT_KEY)
  } catch (e) { /* ok */ }
}

// A tela espera por isto antes de restaurar o rascunho (precisa saber o que
// está pendente). Teto de 1,5 s: IndexedDB travado não pode segurar o app.
export const ready = typeof window === 'undefined'
  ? Promise.resolve()
  : Promise.race([load(), new Promise((ok) => setTimeout(ok, 1500))]).then(() => { notify(); flush() })

// ---------------- consultas síncronas ----------------
const doCaso = (caseId) => (it) => String(it.caseId) === String(caseId) && !it.dead

// marcos deste caso ainda não confirmados: o poll não pode sobrescrevê-los
export function pendingEvents(caseId) {
  return new Set(items.filter(doCaso(caseId)).filter((it) => it.type === 'event.save').map((it) => it.event))
}

// campos da ficha deste caso ainda não confirmados, com a base original
export function pendingPatient(caseId) {
  const meus = items.filter(doCaso(caseId)).filter((it) => it.type === 'patient.patch')
  if (!meus.length) return null
  const out = { changes: {}, base: {} }
  for (const it of meus) {
    for (const k of Object.keys(it.changes)) {
      out.changes[k] = it.changes[k]
      if (!(k in out.base)) out.base[k] = it.base?.[k] ?? ''
    }
  }
  return out
}

export function status(userId) {
  const meus = items.filter((it) => it.userId == null || it.userId === userId)
  return {
    online: state.online,
    auth: state.auth, // 'needed' = sessão expirou: entrar de novo para enviar
    pending: meus.filter((it) => !it.dead).length,
    dead: meus.filter((it) => it.dead).length,
    others: items.length - meus.length, // de outro usuário deste aparelho
    sending: flushing,
  }
}

// ---------------- entrada ----------------
export function enqueueCaseCreate(userId, snapshot, opId, clientId) {
  const tmpId = 'tmp-' + opId
  add({ opId, type: 'case.create', userId, caseId: tmpId, snapshot, clientId })
  notify(); flush()
  return tmpId
}

// o caso ainda não subiu e a pessoa continuou editando: o que sobe é o estado
// mais novo. false = já está em voo (ou já subiu); a tela grava pelo caminho normal.
export function updateCaseCreate(tmpId, snapshot) {
  const it = items.find((x) => x.type === 'case.create' && x.caseId === tmpId && !x.sending && !x.dead)
  if (!it) return false
  it.snapshot = snapshot
  persist(it)
  return true
}

// `changes` é a diferença INTEIRA entre a tela e a base — substitui o envio
// pendente deste caso. A base de um campo que já estava na fila é mantida: é a
// de quando o aparelho divergiu do servidor, e é ela que detecta o conflito.
export function setPatientPatch(userId, caseId, changes, base, baseVersion, clientId) {
  const it = items.find((x) => x.type === 'patient.patch' && String(x.caseId) === String(caseId) && !x.sending && !x.dead)
  const keys = Object.keys(changes)
  if (!keys.length) {
    if (it) { remove(it); notify() }
    return
  }
  const b = Object.fromEntries(keys.map((k) => [k, it && k in (it.base || {}) ? it.base[k] : base?.[k] ?? '']))
  if (it) {
    it.changes = changes; it.base = b; it.at = Date.now()
    persist(it)
  } else {
    add({ type: 'patient.patch', userId, caseId, changes, base: b, baseVersion: baseVersion ?? 0, clientId })
  }
  notify(); flush()
}

export function sendEvent(userId, caseId, event, ts) {
  const it = items.find((x) => x.type === 'event.save' && String(x.caseId) === String(caseId) && x.event === event && !x.sending && !x.dead)
  if (it) { it.ts = ts; persist(it) }
  else add({ type: 'event.save', userId, caseId, event, ts })
  notify(); flush()
}

// itens que o servidor recusou de vez (caso apagado, por exemplo)
export function discardDead(userId) {
  for (const it of items.filter((x) => x.dead && (x.userId == null || x.userId === userId))) remove(it)
  notify()
}

// ---------------- envio ----------------
async function send(it) {
  if (it.type === 'case.create') {
    const r = await api.createCase(it.snapshot, it.clientId, it.opId)
    const tmpId = it.caseId
    try { localStorage.setItem(IDMAP_KEY, JSON.stringify({ ...readIdMap(), [tmpId]: r.id })) } catch (e) { /* ok */ }
    movePatient(it.userId, tmpId, r.id)
    for (const x of items) if (x !== it && x.caseId === tmpId) { x.caseId = r.id; persist(x) }
    return { type: it.type, tmpId, id: r.id, case_ref: r.case_ref, snapshot: it.snapshot }
  }
  if (it.type === 'patient.patch') {
    const r = await api.syncPatient(it.caseId, {
      changes: it.changes, base: it.base, baseVersion: it.baseVersion,
      opId: it.opId, clientTs: it.at, clientId: it.clientId,
    })
    ackPatient(it.userId, it.caseId, it.changes, r.fields || {}, r.version)
    return {
      type: it.type, caseId: it.caseId, sent: it.changes, fields: r.fields || {}, version: r.version,
      updatedAt: r.updatedAt, conflicts: r.conflicts || [], pendingConflicts: r.pendingConflicts || 0,
    }
  }
  const r = await api.saveEvent(it.caseId, it.event, it.ts)
  return { type: it.type, caseId: it.caseId, event: it.event, result: r }
}

function schedule() {
  clearTimeout(timer)
  if (items.some((it) => !it.dead)) timer = setTimeout(flush, RETRY_MS)
}

export async function flush() {
  // pedido que chega com um envio em curso (a rede voltou no meio de uma
  // tentativa que está falhando) não se perde: roda de novo ao terminar
  if (flushing) { denovo = true; return }
  if (!items.some((it) => !it.dead)) return
  flushing = true
  try {
    if (!authed) {
      try {
        authed = (await api.me()).user
        state.online = true; state.auth = null
      } catch (e) {
        if (e.status === 401) { state.online = true; state.auth = 'needed' } else state.online = false
        return
      }
    }
    for (;;) {
      // só o que é de quem está autenticado; dependente de caso que ainda não
      // tem id real espera a criação (que vem antes na fila)
      const it = items.find((x) => !x.dead && !x.sending &&
        (x.userId == null || x.userId === authed.id) &&
        (x.type === 'case.create' || !isTmp(x.caseId)))
      if (!it) break
      it.sending = true
      notify()
      try {
        const ev = await send(it)
        remove(it)
        state.online = true
        emit(ev)
      } catch (e) {
        it.sending = false
        if (e.status === 401) { authed = null; state.auth = 'needed'; break }
        if (transient(e)) { authed = null; state.online = false; break }
        // recusado de vez: sai da frente para não travar a fila, mas não some
        it.dead = true; it.err = String(e.message || e).slice(0, 200)
        persist(it)
        if (it.type === 'case.create') {
          for (const x of items) if (x.caseId === it.caseId && !x.dead) { x.dead = true; x.err = 'caso não foi criado'; persist(x) }
        }
      }
    }
  } finally {
    flushing = false
    schedule()
    notify()
    if (denovo) { denovo = false; flush() }
  }
}

// A tela conta o que vê da rede (o poll de 5 s): com a fila vazia é só por ele
// que o indicador sabe que caiu, e é ele que dispara o reenvio quando volta.
export function netOk() {
  if (state.online) return
  state.online = true; notify(); flush()
}
export function netDown() {
  if (!state.online) return
  state.online = false; authed = null; notify()
}
// troca de usuário / logout: a próxima subida confirma a sessão de novo
export function resetAuth() { authed = null; state.auth = null; notify() }

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { state.online = true; authed = null; notify(); flush() })
  window.addEventListener('offline', () => { state.online = false; authed = null; notify() })
  document.addEventListener('visibilitychange', () => { if (!document.hidden) flush() })
}
