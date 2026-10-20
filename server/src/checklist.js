// Ponte com o app de checklists (checklists.mnrs.com.br, mesmo servidor): o
// operador autenticado aqui lança o checklist da base GOA e ele aparece no
// painel de lá. Sem lógica duplicada — a definição dos itens, as regras de
// validação e o aviso no Telegram continuam sendo do app de checklists.
//   CHECKLIST_URL            (padrão http://127.0.0.1:3030, porta interna do app)
//   CHECKLIST_INTERNAL_TOKEN mesmo INTERNAL_API_TOKEN do app (busca a chave do dia)
const BASE_CODE = 'GOA'
const url = () => (process.env.CHECKLIST_URL || 'http://127.0.0.1:3030').replace(/\/$/, '')

async function call(path, opts = {}) {
  const res = await fetch(url() + path, { ...opts, signal: AbortSignal.timeout(10_000) })
  let data = null
  try { data = await res.json() } catch (e) { /* sem corpo */ }
  if (!res.ok) {
    const err = new Error(data?.error || `checklists respondeu HTTP ${res.status}`)
    err.status = res.status === 403 ? 502 : res.status // 403 de lá = chave; para o cliente é falha de integração
    throw err
  }
  return data
}

// Itens do checklist + situação de hoje da base GOA (médico de plantão, último envio).
export async function carregar() {
  const [def, board] = await Promise.all([call('/api/checklist'), call('/api/board')])
  const base = board.bases.find((b) => b.code === BASE_CODE) || null
  return {
    base: BASE_CODE,
    dayLabel: board.dayLabel,
    plantonista: base?.doctorName || null,
    turno: base?.shiftLabel || null,
    enviadoHoje: base?.submission || null,
    ultimosCampos: base?.lastFields || {},
    groups: def.groups,
    totalItems: def.totalItems,
  }
}

// Lança o checklist: pega a chave do dia pelo canal interno e envia como se
// fosse o formulário público (a validação é a de lá).
export async function enviar({ doctorName, items, occupancyId, doctorId, shiftLabel }) {
  const token = process.env.CHECKLIST_INTERNAL_TOKEN
  if (!token) {
    const err = new Error('integração com checklists não configurada'); err.status = 503; throw err
  }
  const k = await call(`/api/internal/keys/${BASE_CODE}`, { headers: { 'x-internal-token': token } })
  return call('/api/submissions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      baseCode: BASE_CODE, accessKey: k.key, doctorName, items,
      doctorId: doctorId || null, occupancyId: occupancyId || null, shiftLabel: shiftLabel || null,
    }),
  })
}

// ---- histórico, inconformidades (foto) ----
export const historico = () => call(`/api/history/${BASE_CODE}`)

// as fotos passam por aqui (rota com sessão), então a URL pública de lá é trocada pela nossa
export async function inconformidades() {
  const r = await call(`/api/nonconformities/${BASE_CODE}`)
  return { items: r.items.map((n) => ({ ...n, photoUrl: `/api/checklist-goa/nc/photo/${n.id}` })) }
}

export async function fotoInconformidade(id) {
  const res = await fetch(`${url()}/api/nonconformities/photo/${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(10_000) })
  if (!res.ok) { const err = new Error('foto não encontrada'); err.status = res.status === 404 ? 404 : 502; throw err }
  return { tipo: res.headers.get('content-type') || 'image/jpeg', bytes: Buffer.from(await res.arrayBuffer()) }
}

export async function enviarInconformidade({ doctorName, description, photo }) {
  const token = process.env.CHECKLIST_INTERNAL_TOKEN
  if (!token) { const err = new Error('integração com checklists não configurada'); err.status = 503; throw err }
  const k = await call(`/api/internal/keys/${BASE_CODE}`, { headers: { 'x-internal-token': token } })
  return call('/api/nonconformities', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ baseCode: BASE_CODE, accessKey: k.key, doctorName: doctorName || null, description, photo }),
  })
}
