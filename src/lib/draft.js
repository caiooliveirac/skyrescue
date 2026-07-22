// Rascunho local do caso em edição.
//
// Na dinâmica do plantão ninguém clica em "Salvar" antes de sair: o tablet
// dorme, a bateria acaba, a aba é fechada com o caso pela metade, o navegador
// é recarregado. O estado do caso é espelhado no localStorage a cada mudança
// (com debounce) e gravado NA HORA quando a aba some, então reabrir devolve
// exatamente o que estava escrito — sem depender de nenhum botão.
//
// Hipóteses cobertas: recarregar a página, fechar a aba, fechar o navegador,
// crash/queda de energia, aba em segundo plano descartada pelo iOS/Android,
// e voltar dias depois (aí o rascunho já expirou e não ressuscita sozinho).
//
// A chave é POR USUÁRIO: o computador da regulação é compartilhado e o
// rascunho de um plantonista não pode aparecer para o próximo que logar.

const KEY = (userId) => `skyrescue_draft_v1_${userId ?? 'anon'}`
const DEBOUNCE_MS = 700
// depois disso o rascunho é história, não trabalho em curso — não volta
const MAX_AGE_MS = 36 * 3600_000

// há algo digitado que valha a pena guardar? (evita restaurar caso vazio)
export function draftWorthKeeping(snap) {
  if (!snap) return false
  const filled = (o) => o && Object.keys(o).length > 0
  return Boolean(
    snap.scene || snap.notes || snap.ambEta ||
    filled(snap.events) || filled(snap.manualChecked) || filled(snap.gateManual)
  )
}

export function readDraft(userId) {
  try {
    const raw = localStorage.getItem(KEY(userId))
    if (!raw) return null
    const d = JSON.parse(raw)
    if (!d?.snapshot || !draftWorthKeeping(d.snapshot)) return null
    if (!d.at || Date.now() - d.at > MAX_AGE_MS) return null
    return d
  } catch (e) {
    return null // rascunho corrompido não pode impedir o app de abrir
  }
}

export function clearDraft(userId) {
  try { localStorage.removeItem(KEY(userId)) } catch (e) { /* ok */ }
}

// Cria o gravador do rascunho para um usuário. `schedule` é chamado a cada
// mudança de estado; a gravação real é debounced para não bater no
// localStorage a cada tecla digitada.
export function makeDraftSaver(userId) {
  const key = KEY(userId)
  let timer = null
  let pending = null

  const write = () => {
    if (timer) { clearTimeout(timer); timer = null }
    if (!pending) return
    try {
      localStorage.setItem(key, JSON.stringify({ ...pending, at: Date.now() }))
    } catch (e) {
      // cota estourada ou modo privativo: o app continua, só sem rascunho
      console.warn('rascunho não salvo:', e?.message || e)
    }
    pending = null
  }

  // A aba pode morrer sem aviso. `beforeunload` não dispara no iOS e é
  // ignorado quando o SO descarta a aba em segundo plano; `visibilitychange`
  // (hidden) e `pagehide` são os únicos confiáveis nos dois mundos — nesses
  // eventos grava-se de forma síncrona, sem esperar o debounce.
  const flush = () => { if (pending) write() }
  const onHide = () => { if (document.visibilityState === 'hidden') flush() }
  document.addEventListener('visibilitychange', onHide)
  window.addEventListener('pagehide', flush)
  window.addEventListener('beforeunload', flush)

  return {
    schedule(payload) {
      pending = payload
      if (timer) clearTimeout(timer)
      timer = setTimeout(write, DEBOUNCE_MS)
    },
    flush,
    clear() {
      if (timer) { clearTimeout(timer); timer = null }
      pending = null
      clearDraft(userId)
    },
    dispose() {
      flush()
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', flush)
      window.removeEventListener('beforeunload', flush)
    },
  }
}
