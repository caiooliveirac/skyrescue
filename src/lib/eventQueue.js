import { api } from './backend.js'

// Fila offline dos horários da missão: em voo é comum não ter dados de
// celular na hora do toque — o horário fica guardado no aparelho e é
// reenviado quando a conexão volta (o timestamp original é preservado).
const KEY = 'skyrescue_evt_queue_v1'

const load = () => {
  try { return JSON.parse(localStorage.getItem(KEY)) || [] } catch { return [] }
}
const save = (q) => {
  try { localStorage.setItem(KEY, JSON.stringify(q)) } catch { /* sem storage: fica só em memória */ }
}

let flushing = false
let timer = null

// Marcos deste caso que ainda não chegaram ao servidor (sem sinal, ou POST em
// voo). O poll de tempo real precisa saber quais NÃO pode sobrescrever com o
// estado do servidor — senão o horário que o piloto acabou de tocar some da
// tela dele por alguns segundos e volta depois.
const inflight = new Set()
const key = (caseId, event) => `${caseId}:${event}`
export function pendingEvents(caseId) {
  const ids = new Set()
  for (const it of load()) if (String(it.caseId) === String(caseId)) ids.add(it.event)
  for (const k of inflight) {
    const [cid, ev] = k.split(':')
    if (cid === String(caseId)) ids.add(ev)
  }
  return ids
}

function schedule() {
  clearTimeout(timer)
  if (load().length) timer = setTimeout(flush, 20_000)
}

export async function flush() {
  if (flushing) return
  flushing = true
  try {
    let q = load()
    while (q.length) {
      const it = q[0]
      try { await api.saveEvent(it.caseId, it.event, it.ts) } catch { break }
      q = q.slice(1)
      save(q)
    }
  } finally {
    flushing = false
    schedule()
  }
}

// Envia um horário ao servidor; se falhar (ou se já houver pendências,
// para preservar a ordem), entra na fila e tenta de novo depois.
// `onResult` recebe a resposta do servidor no envio direto — é por ela que o
// app fica sabendo que o marco do acionamento abriu o grupo da missão. Pelo
// caminho da fila não há retorno (outra sessão, talvez outro dia): o servidor
// aciona o grupo do mesmo jeito, o app só descobre ao reabrir o caso.
export function sendEvent(caseId, event, ts, onResult) {
  const q = load()
  const rest = q.filter((it) => !(it.caseId === caseId && it.event === event))
  if (q.length) {
    save([...rest, { caseId, event, ts }])
    flush()
    return
  }
  // dois argumentos, não .catch(): assim um erro dentro do onResult (React) não
  // é confundido com falha de rede e não reenfileira um horário já gravado
  const k = key(caseId, event)
  inflight.add(k)
  api.saveEvent(caseId, event, ts).then(
    (r) => { inflight.delete(k); onResult?.(r) },
    () => { inflight.delete(k); save([...rest, { caseId, event, ts }]); schedule() }
  )
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', flush)
  flush() // pendências de uma sessão anterior (app fechado sem sinal)
}
