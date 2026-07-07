// ------------------------------------------------------------------
// Pontuação SkyRescue — checklist de elegibilidade com pesos e tetos
// Faixas: 0–4 verde (terrestre) · 5–8 amarelo (avaliação do MR)
//         ≥9 vermelho (forte indicação de avaliação p/ aéreo)
// Gates operacionais NÃO pontuam: qualquer gate reprovado torna o
// acionamento inviável no momento, independentemente do score.
// ------------------------------------------------------------------

export const BANDS = [
  { min: 9, key: 'red', label: 'FORTE INDICAÇÃO de avaliação para acionamento aeromédico' },
  { min: 5, key: 'yellow', label: 'Zona de avaliação do médico regulador' },
  { min: 0, key: 'green', label: 'Transporte terrestre preferencial' },
]

export const SECTIONS = [
  {
    id: 'loc',
    title: 'Operacional / Localização',
    cap: 3,
    capNote: 'máx. 3 pts',
    items: [
      { id: 'loc_dificil', label: 'Área de difícil acesso', pts: 1 },
      { id: 'loc_congest', label: 'Congestionamento importante', pts: 1 },
      { id: 'loc_rodovia', label: 'Rodovia distante', pts: 1 },
      { id: 'loc_rural', label: 'Zona rural', pts: 1 },
      { id: 'loc_ilha', label: 'Ilha', pts: 1 },
      { id: 'loc_serra', label: 'Serra / mata', pts: 1 },
      { id: 'loc_semacesso', label: 'Região sem acesso rápido', pts: 1 },
    ],
  },
  {
    id: 'tempo',
    title: 'Tempo',
    cap: 7,
    items: [
      { id: 't_60', label: 'Tempo terrestre até o hospital > 60 min', pts: 3, auto: true },
      { id: 't_reduz', label: 'Aeronave reduz significativamente o tempo (≥20 min ou ≥30%)', pts: 2, auto: true },
      { id: 't_beneficio', label: 'Condição tempo-dependente se beneficia de chegada mais rápida', pts: 2 },
    ],
  },
  {
    id: 'grav',
    title: 'Gravidade do paciente',
    cap: 6,
    capNote: '3 pts por item · máx. 6',
    groups: [
      {
        name: 'Trauma',
        items: [
          { id: 'g_energia', label: 'Trauma de alta energia', pts: 3 },
          { id: 'g_tce', label: 'TCE grave (GCS ≤ 8)', pts: 3 },
          { id: 'g_hemo', label: 'Instabilidade hemodinâmica', pts: 3 },
          { id: 'g_amput', label: 'Amputação traumática', pts: 3 },
          { id: 'g_torax', label: 'Trauma torácico grave', pts: 3 },
          { id: 'g_abd', label: 'Trauma abdominal grave', pts: 3 },
          { id: 'g_pelve', label: 'Trauma pélvico', pts: 3 },
          { id: 'g_fraturas', label: 'Fraturas múltiplas / politrauma', pts: 3 },
          { id: 'g_queimadura', label: 'Queimadura grave', pts: 3 },
          { id: 'g_transfusao', label: 'Necessidade de transfusão maciça', pts: 3 },
        ],
      },
      {
        name: 'Clínico',
        items: [
          { id: 'g_iam', label: 'IAM com supra de ST', pts: 3 },
          { id: 'g_avc', label: 'AVC candidato a trombólise/trombectomia', pts: 3 },
          { id: 'g_septico', label: 'Choque séptico', pts: 3 },
          { id: 'g_cardiogenico', label: 'Choque cardiogênico', pts: 3 },
          { id: 'g_resp', label: 'Insuficiência respiratória grave', pts: 3 },
          { id: 'g_epileptico', label: 'Estado de mal epiléptico', pts: 3 },
          { id: 'g_pcr', label: 'PCR com RCE + necessidade de centro especializado', pts: 3 },
        ],
      },
      {
        name: 'Pediatria',
        items: [
          { id: 'g_ped_trauma', label: 'Trauma grave pediátrico', pts: 3 },
          { id: 'g_ped_choque', label: 'Choque / PCR pediátrico', pts: 3 },
          { id: 'g_ped_sepse', label: 'Sepse pediátrica', pts: 3 },
          { id: 'g_ped_resp', label: 'Insuf. respiratória pediátrica', pts: 3 },
        ],
      },
      {
        name: 'Obstetrícia',
        items: [
          { id: 'g_ob_hemorragia', label: 'Hemorragia obstétrica grave', pts: 3 },
          { id: 'g_ob_eclampsia', label: 'Eclâmpsia', pts: 3 },
          { id: 'g_ob_emergencia', label: 'Emergência materna tempo-dependente', pts: 3 },
        ],
      },
    ],
  },
  {
    id: 'centro',
    title: 'Necessidade de centro especializado',
    cap: 2,
    capNote: 'máx. 2 pts',
    items: [
      { id: 'c_trauma', label: 'Centro de Trauma', pts: 2, tag: 'trauma' },
      { id: 'c_neuro', label: 'Neurocirurgia', pts: 2, tag: 'neuro' },
      { id: 'c_hemo', label: 'Hemodinâmica', pts: 2, tag: 'hemodinamica' },
      { id: 'c_queimados', label: 'Centro de Queimados', pts: 2, tag: 'queimados' },
      { id: 'c_ecmo', label: 'ECMO', pts: 2 },
      { id: 'c_utiped', label: 'UTI Pediátrica', pts: 2, tag: 'ped' },
      { id: 'c_terciario', label: 'Hospital terciário', pts: 2 },
    ],
  },
]

export function allItems() {
  const out = []
  for (const s of SECTIONS) {
    if (s.items) out.push(...s.items.map((i) => ({ ...i, section: s.id })))
    if (s.groups) for (const g of s.groups) out.push(...g.items.map((i) => ({ ...i, section: s.id, group: g.name })))
  }
  return out
}

const ITEMS = allItems()
export const ITEM_BY_ID = Object.fromEntries(ITEMS.map((i) => [i.id, i]))

// checkedFn(id) -> boolean efetivo (inclui autos e overrides)
export function computeScore(checkedFn) {
  const perSection = {}
  let total = 0
  for (const s of SECTIONS) {
    const items = s.items || s.groups.flatMap((g) => g.items)
    let raw = 0
    const hits = []
    for (const it of items) {
      if (checkedFn(it.id)) {
        raw += it.pts
        hits.push(it.label)
      }
    }
    const capped = s.cap != null ? Math.min(raw, s.cap) : raw
    perSection[s.id] = { raw, capped, cap: s.cap, hits }
    total += capped
  }
  const band = BANDS.find((b) => total >= b.min) || BANDS[BANDS.length - 1]
  return { total, perSection, band }
}

// ------------------- GATES (condições operacionais) -------------------
export const GATES = [
  { id: 'g_aeronave', label: 'Aeronave disponível', short: 'Aeronave', manual: true },
  { id: 'g_equipe', label: 'Equipe disponível', short: 'Equipe', manual: true },
  { id: 'g_meteo', label: 'Meteorologia compatível', short: 'Meteo', auto: 'weather' },
  { id: 'g_janela', label: 'Janela diurna suficiente (VFR)', short: 'Janela', auto: 'daylight' },
  { id: 'g_lz', label: 'Local de pouso viável', short: 'LZ', auto: 'lz' },
  { id: 'g_comb', label: 'Autonomia / combustível suficiente', short: 'Autonomia', auto: 'range' },
  { id: 'g_seg', label: 'Segurança operacional preservada', short: 'Segurança', manual: true },
]

// autoStatus: {weather:'ok|warn|fail|unknown', daylight:..., lz:..., range:...}
// manualVals: {g_aeronave:bool,...}; overrides: {gateId:'ok'|'fail'|undefined}
export function evaluateGates(autoStatus, manualVals, overrides) {
  const rows = GATES.map((g) => {
    let status
    if (g.manual) {
      status = manualVals[g.id] === false ? 'fail' : 'ok'
    } else {
      status = autoStatus[g.auto] || 'unknown'
    }
    const ov = overrides[g.id]
    const effective = ov || status
    return { ...g, status, override: ov || null, effective }
  })
  const fails = rows.filter((r) => r.effective === 'fail')
  const warns = rows.filter((r) => r.effective === 'warn' || r.effective === 'unknown')
  return { rows, ok: fails.length === 0, fails, warns }
}

export function recommendation(score, gates) {
  if (!gates.ok) {
    return {
      key: 'blocked',
      title: 'ACIONAMENTO AÉREO INVIÁVEL NO MOMENTO',
      detail: 'Impeditivos: ' + gates.fails.map((f) => f.label).join('; ') + '. Manter recurso terrestre e reavaliar se as condições mudarem.',
    }
  }
  const map = {
    red: { key: 'red', title: BANDS[0].label, detail: 'Contatar o GOA/CBMBA e validar com o comandante da aeronave.' },
    yellow: { key: 'yellow', title: BANDS[1].label, detail: 'Pesar benefício clínico × logística com os tempos calculados.' },
    green: { key: 'green', title: BANDS[2].label, detail: 'Score baixo: via terrestre tende a ser mais eficiente neste caso.' },
  }
  return map[score.band.key]
}
