// ------------------------------------------------------------------
// Ficha do paciente (prontuário) — dados IDENTIFICÁVEIS.
//
// A ficha é do CASO e mora no servidor (tabela `case_patient`), porque a
// ocorrência é acompanhada em várias telas ao mesmo tempo: o que o médico
// acrescenta no celular tem que aparecer para quem está na regulação. Ver
// GET/PATCH /api/cases/:id/patient.
//
// Fronteira que continua de pé: a PII NUNCA entra no `snapshot` do caso.
// O snapshot alimenta o briefing do Telegram, a listagem e o relatório —
// dado de paciente ali vazaria por construção. Caminho próprio, tabela
// própria, e no poll de 5 s viaja só o carimbo de tempo (`patientAt`).
//
// O localStorage abaixo é ESPELHO OFFLINE, não fonte da verdade: em voo
// com 4G ruim é ele que segura o que foi digitado até a rede voltar.
// Ao abrir o caso, a ficha do servidor vence quando tem conteúdo.
// ------------------------------------------------------------------

// Estrutura compartilhada pelo formulário e pelo documento impresso.
// w:2 = campo ocupa a linha inteira (2 colunas) no grid do form.
// req = exigido para o caso ficar documentado (ver lib/pendencias.js); não
// bloqueia nada, só cobra.
export const PATIENT_SECTIONS = [
  {
    id: 'ident',
    title: 'Identificação do paciente',
    fields: [
      { k: 'nome', req: true, label: 'Nome completo', w: 2 },
      { k: 'nascimento', req: true, label: 'Data de nascimento', type: 'date' },
      { k: 'sexo', req: true, label: 'Sexo', type: 'select', opts: ['', 'Feminino', 'Masculino', 'Outro / Não informado'] },
      { k: 'nomeMae', label: 'Nome da mãe', w: 2 },
      { k: 'cpf', label: 'CPF' },
      { k: 'cns', label: 'CNS (Cartão SUS)' },
      { k: 'municipio', label: 'Município de residência', w: 2 },
    ],
  },
  {
    id: 'clinico',
    title: 'Quadro clínico',
    fields: [
      { k: 'queixa', req: true, label: 'Queixa principal / mecanismo', type: 'textarea', w: 2 },
      { k: 'pa', req: true, label: 'PA (mmHg)' },
      { k: 'fc', req: true, label: 'FC (bpm)' },
      { k: 'fr', label: 'FR (irpm)' },
      { k: 'spo2', req: true, label: 'SpO₂ (%)' },
      { k: 'tax', label: 'Tax (°C)' },
      { k: 'hgt', label: 'HGT (mg/dL)' },
      { k: 'gcs', req: true, label: 'GCS (3–15)' },
      { k: 'dor', label: 'Dor (EVA 0–10)' },
      { k: 'alergias', label: 'Alergias', w: 2 },
      { k: 'comorbidades', label: 'Comorbidades', w: 2 },
      { k: 'medUso', label: 'Medicação em uso', w: 2 },
    ],
  },
  {
    id: 'conduta',
    title: 'Avaliação e conduta',
    fields: [
      { k: 'hipotese', req: true, label: 'Hipótese diagnóstica', w: 2 },
      { k: 'cid', label: 'CID-10' },
      { k: 'risco', req: true, label: 'Classificação de risco', type: 'select',
        opts: ['', 'Vermelho (emergência)', 'Laranja (muito urgente)', 'Amarelo (urgente)', 'Verde (pouco urgente)', 'Azul (não urgente)'] },
      { k: 'procedimentos', label: 'Procedimentos realizados', type: 'textarea', w: 2 },
      { k: 'medicacoes', label: 'Medicações administradas (nome · dose · via · hora)', type: 'textarea', w: 2 },
      { k: 'intercorrencias', label: 'Intercorrências no transporte', type: 'textarea', w: 2 },
    ],
  },
  {
    id: 'autor',
    title: 'Responsável pela regulação',
    fields: [
      { k: 'medico', req: true, label: 'Médico regulador' },
      { k: 'crm', req: true, label: 'CRM / UF' },
      { k: 'equipe', req: true, label: 'Equipe de transporte (enfermeiro, piloto…)', w: 2 },
    ],
  },
]

export const PATIENT_KEYS = PATIENT_SECTIONS.flatMap((s) => s.fields.map((f) => f.k))

export function emptyPatient() {
  return Object.fromEntries(PATIENT_KEYS.map((k) => [k, '']))
}

export function patientFilled(p) {
  return Boolean(p) && PATIENT_KEYS.some((k) => String(p[k] || '').trim() !== '')
}

// O médico regulador é pré-preenchido com quem está logado. Uma ficha que só
// tem isso não é ficha de ninguém: não merece uma gaveta, e sobretudo não pode
// gastar a cota das fichas de verdade quando o plantonista abre caso atrás de
// caso só para consultar.
const AUTO_KEYS = ['medico']
export function patientWorthKeeping(p) {
  return Boolean(p) && PATIENT_KEYS.some(
    (k) => !AUTO_KEYS.includes(k) && String(p[k] || '').trim() !== ''
  )
}

// ---------------- espelho offline (por usuário E por caso) ----------------
//
// Cópia local do que está (ou vai estar) no servidor. Duas funções:
//
// 1. Segurar o texto quando a rede cai. A ficha é digitada na cena e em voo,
//    onde o 4G falha; o PATCH que não sai fica esperando e o espelho garante
//    que nada some da tela enquanto isso.
// 2. Guardar a ficha do caso que ainda NÃO existe no servidor — o rascunho.
//    Quando o caso é criado, a gaveta migra junto com ele (ver movePatient).
//
// A chave carrega o caso, e isso não é detalhe: quando ela era só do usuário,
// abrir qualquer caso zerava o formulário e o espelho gravava esse vazio por
// cima — quem digitava a ficha e reabria o caso para conferir perdia tudo.
const PREFIX = 'skyrescue_patient_v2_'
const KEY = (userId, caseId) =>
  `${PREFIX}${userId ?? 'anon'}_${caseId == null ? 'rascunho' : 'c' + caseId}`
// chave da v1 (uma ficha por usuário, sem caso) — migrada no primeiro boot
const LEGACY_KEY = (userId) => `skyrescue_patient_v1_${userId ?? 'anon'}`

// PII não pode se acumular sem fim no navegador da regulação, que é máquina
// compartilhada: a ficha é cópia de trabalho, o documento definitivo é o PDF
// assinado e arquivado. Fichas velhas saem por idade (de qualquer usuário) e
// cada usuário guarda no máximo as MAX_KEEP mais recentes.
const MAX_KEEP = 30
const MAX_AGE_MS = 90 * 24 * 3600_000

function allKeys() {
  const out = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k && k.startsWith(PREFIX)) out.push(k)
  }
  return out
}

function savedAt(k) {
  try { return JSON.parse(localStorage.getItem(k))?.at || 0 } catch (e) { return 0 }
}

// `atual` é a gaveta que acabou de ser escrita: ela nunca é candidata a sair.
// Sem essa garantia, duas gravações no mesmo milissegundo empatam no `at` e o
// desempate arbitrário poderia jogar fora justamente o que está sendo digitado.
function prune(userId, atual) {
  try {
    const now = Date.now()
    const mine = []
    const meu = `${PREFIX}${userId ?? 'anon'}_`
    for (const k of allKeys()) {
      if (k === atual) continue
      const at = savedAt(k)
      if (at && now - at > MAX_AGE_MS) { localStorage.removeItem(k); continue }
      if (k.startsWith(meu)) mine.push({ k, at })
    }
    mine.sort((a, b) => b.at - a.at)
    mine.slice(Math.max(0, MAX_KEEP - 1)).forEach(({ k }) => localStorage.removeItem(k))
  } catch (e) { /* faxina é best-effort; não pode derrubar o app */ }
}

export function readPatient(userId, caseId) {
  try {
    const raw = localStorage.getItem(KEY(userId, caseId))
    if (!raw) return null
    const d = JSON.parse(raw)
    const p = d && typeof d === 'object' ? d.patient : null
    return p && typeof p === 'object' ? { ...emptyPatient(), ...p } : null
  } catch (e) {
    return null // ficha corrompida não pode impedir o caso de abrir
  }
}

export function savePatient(userId, caseId, p) {
  try {
    if (patientWorthKeeping(p)) {
      const key = KEY(userId, caseId)
      localStorage.setItem(key, JSON.stringify({ at: Date.now(), patient: p }))
      prune(userId, key)
    } else {
      // ficha esvaziada de propósito some — mas só a DESTE caso
      localStorage.removeItem(KEY(userId, caseId))
    }
  } catch (e) {
    console.warn('ficha não salva:', e?.message || e)
  }
}

export function clearPatient(userId, caseId) {
  try { localStorage.removeItem(KEY(userId, caseId)) } catch (e) { /* ok */ }
}

// O caso acabou de ganhar id no servidor: a ficha digitada antes disso muda de
// gaveta junto com ele, senão ficaria órfã no rascunho e sumiria no próximo
// "Novo caso".
export function movePatient(userId, fromCaseId, toCaseId) {
  try {
    const from = KEY(userId, fromCaseId)
    const raw = localStorage.getItem(from)
    if (!raw) return
    localStorage.setItem(KEY(userId, toCaseId), raw)
    localStorage.removeItem(from)
  } catch (e) { /* ok */ }
}

// Migração da v1. O que estiver na chave antiga é a ficha do caso que a pessoa
// tinha em mãos: vira a ficha do rascunho e segue com ele.
export function migrateLegacyPatient(userId) {
  try {
    const raw = localStorage.getItem(LEGACY_KEY(userId))
    if (!raw) return
    localStorage.removeItem(LEGACY_KEY(userId))
    const p = { ...emptyPatient(), ...(JSON.parse(raw) || {}) }
    const alvo = KEY(userId, null)
    if (patientWorthKeeping(p) && !localStorage.getItem(alvo)) {
      localStorage.setItem(alvo, JSON.stringify({ at: Date.now(), patient: p }))
    }
  } catch (e) { /* ok */ }
}

// ---------------- helpers de apresentação ----------------
export function ageFrom(nascimento) {
  if (!nascimento) return ''
  const d = new Date(nascimento + 'T00:00:00')
  if (isNaN(d)) return ''
  const now = new Date()
  let a = now.getFullYear() - d.getFullYear()
  const m = now.getMonth() - d.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) a--
  return a >= 0 && a < 150 ? `${a} anos` : ''
}
