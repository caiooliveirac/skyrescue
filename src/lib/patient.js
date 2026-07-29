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
export const PATIENT_SECTIONS = [
  {
    id: 'ident',
    title: 'Identificação do paciente',
    fields: [
      { k: 'nome', label: 'Nome completo', w: 2 },
      { k: 'nascimento', label: 'Data de nascimento', type: 'date' },
      { k: 'sexo', label: 'Sexo', type: 'select', opts: ['', 'Feminino', 'Masculino', 'Outro / Não informado'] },
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
      { k: 'queixa', label: 'Queixa principal / mecanismo', type: 'textarea', w: 2 },
      { k: 'pa', label: 'PA (mmHg)' },
      { k: 'fc', label: 'FC (bpm)' },
      { k: 'fr', label: 'FR (irpm)' },
      { k: 'spo2', label: 'SpO₂ (%)' },
      { k: 'tax', label: 'Tax (°C)' },
      { k: 'hgt', label: 'HGT (mg/dL)' },
      { k: 'gcs', label: 'GCS (3–15)' },
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
      { k: 'hipotese', label: 'Hipótese diagnóstica', w: 2 },
      { k: 'cid', label: 'CID-10' },
      { k: 'risco', label: 'Classificação de risco', type: 'select',
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
      { k: 'medico', label: 'Médico regulador' },
      { k: 'crm', label: 'CRM / UF' },
      { k: 'equipe', label: 'Equipe de transporte (enfermeiro, piloto…)', w: 2 },
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

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

// linha de tabela: só renderiza se houver valor (documento não fica poluído de "—")
const row = (label, value) => {
  const v = value == null ? '' : String(value).trim()
  return v ? `<tr><th>${esc(label)}</th><td>${esc(v).replace(/\n/g, '<br>')}</td></tr>` : ''
}
const nl2br = (s) => esc(s).replace(/\n/g, '<br>')

// ------------------------------------------------------------------
// Documento autônomo (HTML self-contained) — imprimível como PDF e
// anexável a e-mail. `ctx` traz o contexto OPERACIONAL já calculado
// pelo app (score, tempos, destino, cronologia), para o médico não
// redigitar nada. Só a PII vem de `patient`.
// ------------------------------------------------------------------
export function buildProntuarioHTML(patient, ctx = {}) {
  const p = { ...emptyPatient(), ...(patient || {}) }
  const nascFmt = p.nascimento
    ? new Date(p.nascimento + 'T00:00:00').toLocaleDateString('pt-BR')
    : ''
  const idade = ageFrom(p.nascimento)
  const nascLinha = [nascFmt, idade].filter(Boolean).join(' · ')

  const now = new Date()
  const vitais = [
    p.pa && `PA ${p.pa}`, p.fc && `FC ${p.fc}`, p.fr && `FR ${p.fr}`,
    p.spo2 && `SpO₂ ${p.spo2}%`, p.tax && `Tax ${p.tax}°C`, p.hgt && `HGT ${p.hgt}`,
    p.gcs && `GCS ${p.gcs}`, p.dor && `Dor ${p.dor}/10`,
  ].filter(Boolean).join(' · ')

  const cronologia = (ctx.cronologia || []).filter((c) => c.time)
  const cronoHTML = cronologia.length
    ? `<h2>Cronologia da missão</h2><table><tbody>${cronologia.map((c) => row(c.label, c.time)).join('')}</tbody></table>`
    : ''

  const identRows = [
    row('Nome', p.nome),
    row('Nascimento / idade', nascLinha),
    row('Sexo', p.sexo),
    row('Nome da mãe', p.nomeMae),
    row('CPF', p.cpf),
    row('CNS (Cartão SUS)', p.cns),
    row('Município', p.municipio),
  ].join('')

  const clinRows = [
    row('Queixa / mecanismo', p.queixa),
    row('Sinais vitais', vitais),
    row('Alergias', p.alergias),
    row('Comorbidades', p.comorbidades),
    row('Medicação em uso', p.medUso),
  ].join('')

  const condutaRows = [
    row('Hipótese diagnóstica', p.hipotese),
    row('CID-10', p.cid),
    row('Classificação de risco', p.risco),
    row('Procedimentos realizados', p.procedimentos),
    row('Medicações administradas', p.medicacoes),
    row('Intercorrências no transporte', p.intercorrencias),
  ].join('')

  const regRows = [
    row('Origem / cena', ctx.sceneLabel),
    row('Coordenadas da cena', ctx.sceneCoords),
    row('Destino', ctx.destino),
    row('Meio de transporte', ctx.meio),
    row('Justificativa (SkyRescue)', ctx.justificativa),
    row('Critérios de gravidade', ctx.criterios),
    row('Tempos estimados', ctx.tempos),
    row('Ponto de pouso (LZ)', ctx.lz),
    row('Equipe de transporte', p.equipe),
  ].join('')

  const medico = p.medico || ctx.medico || ''
  const crm = p.crm || ''

  const title = `Ficha de Regulação Médica — ${ctx.caseId ? 'Caso ' + esc(ctx.caseId) : 'SkyRescue'}`
  const fileTag = (ctx.caseId || 'prontuario').replace(/[^\w-]+/g, '-')

  return `<!doctype html>
<html lang="pt-BR"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  :root { --ink:#111; --mut:#555; --line:#bbb; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #f2f4f7; color: var(--ink);
    font: 13px/1.5 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  .toolbar { position: sticky; top: 0; display: flex; gap: 10px; align-items: center;
    padding: 10px 16px; background: #0b1220; color: #fff; }
  .toolbar button { font: inherit; font-weight: 600; cursor: pointer;
    border: none; border-radius: 8px; padding: 9px 16px; background: #22d3ee; color: #04212a; }
  .toolbar button.sec { background: rgba(255,255,255,.14); color: #fff; }
  .toolbar .hint { font-size: 12px; color: #9fb0c4; margin-left: auto; }
  .sheet { max-width: 780px; margin: 18px auto 60px; background: #fff; color: #000;
    padding: 34px 40px; box-shadow: 0 6px 30px rgba(0,0,0,.18); }
  h1 { font-size: 19px; margin: 0 0 2px; }
  .meta { font-size: 11px; color: var(--mut); margin-bottom: 4px; }
  h2 { font-size: 13px; margin: 20px 0 6px; text-transform: uppercase; letter-spacing: .04em;
    border-bottom: 1.5px solid #333; padding-bottom: 3px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid var(--line); padding: 5px 9px; text-align: left; vertical-align: top; }
  th { width: 210px; background: #f6f8fa; font-weight: 600; }
  .sig { margin-top: 54px; }
  .sig .line { border-top: 1px solid #000; width: 340px; padding-top: 5px; font-size: 12px; }
  .sig .gov { margin-top: 14px; font-size: 11px; color: var(--mut);
    border: 1px dashed #999; border-radius: 6px; padding: 10px 12px; background: #fafafa; }
  .foot { margin-top: 22px; font-size: 10px; color: #777; line-height: 1.4; }
  @media print {
    body { background: #fff; }
    .toolbar { display: none; }
    .sheet { box-shadow: none; margin: 0; max-width: none; padding: 0; }
    h2 { break-after: avoid; }
    tr, table { break-inside: avoid; }
  }
</style></head>
<body>
  <div class="toolbar">
    <button onclick="window.print()">🖨️ Imprimir / Salvar como PDF</button>
    <button class="sec" onclick="download()">⬇️ Baixar HTML</button>
    <span class="hint">Salve como PDF e anexe ao e-mail. Assine no gov.br (assinador.iti.br) antes de arquivar.</span>
  </div>
  <div class="sheet" id="sheet">
    <h1>Ficha de Regulação Médica / Prontuário de Atendimento</h1>
    <div class="meta">SAMU 192 Salvador × GOA/CBMBA${ctx.caseId ? ' · Caso ' + esc(ctx.caseId) : ''} · Emitido em ${now.toLocaleString('pt-BR')}</div>

    <h2>Identificação do paciente</h2>
    <table><tbody>${identRows || row('—', 'não preenchido')}</tbody></table>

    <h2>Quadro clínico</h2>
    <table><tbody>${clinRows || row('—', 'não preenchido')}</tbody></table>

    <h2>Avaliação e conduta</h2>
    <table><tbody>${condutaRows || row('—', 'não preenchido')}</tbody></table>

    <h2>Regulação e transporte</h2>
    <table><tbody>${regRows}</tbody></table>
    ${cronoHTML}

    <div class="sig">
      <div class="line">${medico ? esc(medico) : 'Médico regulador'}${crm ? ' — ' + esc(crm) : ''}</div>
      <div class="gov">
        <b>Assinatura digital</b> — este documento foi emitido para ser assinado eletronicamente pelo
        médico responsável no <b>gov.br</b> (assinador.iti.br ou app gov.br): salve como PDF, faça o
        upload no assinador e assine com sua conta gov.br. A assinatura carimba a autoria e a
        integridade do documento.
      </div>
    </div>

    <div class="foot">
      Documento gerado pelo SkyRescue β a partir da ficha preenchida pela regulação. Os dados
      operacionais (score, tempos, LZ, meteorologia) são estimativas de apoio à decisão e não
      substituem o julgamento do médico regulador nem a decisão do comandante da aeronave.
      Confira a validade jurídica exigida (assinatura avançada gov.br × qualificada ICP-Brasil)
      conforme as normas do CFM/SESAB antes de arquivar como prontuário definitivo.
    </div>
  </div>
  <script>
    function download() {
      var html = '<!doctype html>' + document.documentElement.outerHTML;
      var blob = new Blob([html], { type: 'text/html' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = ${JSON.stringify('prontuario-' + fileTag + '.html')};
      a.click();
    }
  </script>
</body></html>`
}

// Abre o prontuário em nova aba; se o pop-up for bloqueado, baixa o arquivo.
export function openProntuario(patient, ctx) {
  const html = buildProntuarioHTML(patient, ctx)
  const w = window.open('', '_blank')
  if (w && w.document) {
    w.document.open()
    w.document.write(html)
    w.document.close()
    return true
  }
  // pop-up bloqueado — cai para download do arquivo
  const blob = new Blob([html], { type: 'text/html' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'prontuario-' + (ctx?.caseId || 'caso').replace(/[^\w-]+/g, '-') + '.html'
  a.click()
  return false
}
