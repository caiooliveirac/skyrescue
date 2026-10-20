import { haversineKm } from './geo.js'

// ------------------------------------------------------------------
// Estatísticas das ocorrências + diagnóstico dos horários registrados.
//
// Os horários da missão moram em snapshot.events (ms). Nem todo horário
// gravado é o horário do evento: há marcos tocados um atrás do outro no fim
// da missão (fica a hora do clique), marcados dias depois ao reabrir um caso
// antigo, ou fora de ordem. O diagnóstico aponta isso caso a caso e as
// contas de tempo só usam o intervalo cujas duas pontas são confiáveis.
// Puro (sem React, sem rede): testado por scripts/test-stats.js.
// ------------------------------------------------------------------

export const MARCOS = ['decisao', 'decolagem', 'pouso_cena', 'paciente', 'decolagem2', 'pouso_destino', 'entrega']
export const MARCO_LABEL = {
  decisao: 'Acionamento autorizado',
  decolagem: 'Decolagem p/ cena',
  pouso_cena: 'Pouso na cena',
  paciente: 'Contato c/ paciente',
  decolagem2: 'Decolagem p/ destino',
  pouso_destino: 'Pouso no destino',
  entrega: 'Paciente acolhido',
  livre: 'Aeronave liberada',
  cancelado: 'Envio cancelado',
}

// etapas consecutivas da missão; max = acima disso não é tempo de etapa, é
// horário errado (minutos)
export const ETAPAS = [
  { id: 'resposta', de: 'decisao', ate: 'decolagem', label: 'Acionamento → decolagem', max: 120 },
  { id: 'voo_ida', de: 'decolagem', ate: 'pouso_cena', label: 'Voo até a cena', max: 120 },
  { id: 'cena', de: 'pouso_cena', ate: 'paciente', label: 'Pouso → contato com o paciente', max: 180 },
  { id: 'embarque', de: 'paciente', ate: 'decolagem2', label: 'Contato → decolagem p/ destino', max: 120 },
  { id: 'voo_destino', de: 'decolagem2', ate: 'pouso_destino', label: 'Voo até o destino', max: 120 },
  { id: 'acolhimento', de: 'pouso_destino', ate: 'entrega', label: 'Pouso → paciente acolhido', max: 120 },
]
export const TOTAIS = [
  { id: 'ate_paciente', de: 'decisao', ate: 'paciente', label: 'Acionamento → contato com o paciente', min: 5, max: 300 },
  { id: 'total', de: 'decisao', ate: 'entrega', label: 'Acionamento → paciente acolhido', min: 10, max: 480 },
]

const MIN_GAP_MS = 60_000        // dois marcos a menos de 1 min = tocados em sequência
const DIA_MS = 24 * 3600_000
const TARDIO_MS = 15 * 60_000    // marcado mais de 15 min depois do horário informado

const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))

function horarios(c) {
  const ev = {}
  for (const [k, v] of Object.entries(c.events || {})) {
    const t = num(v)
    if (t != null && t > 0) ev[k] = t
  }
  return ev
}

// ---------- diagnóstico de um caso ----------
// nivel: 'vazio' (sem horário) | 'erro' (horário não confiável) |
//        'parcial' (faltam marcos) | 'ok'
export function diagnose(c) {
  const ev = horarios(c)
  const presentes = MARCOS.filter((k) => ev[k] != null)
  const cancelado = ev.cancelado != null
  const problemas = []
  const suspeitos = new Set() // marcos cuja hora não vale para conta de tempo

  if (!presentes.length) {
    return { nivel: 'vazio', ev, presentes, cancelado, faltam: MARCOS.slice(), problemas: [{ nivel: 'erro', texto: 'Nenhum horário registrado' }], suspeitos, aoVivo: 0, depois: 0 }
  }

  // marcados em sequência: hora do clique, não do evento
  const ord = presentes.slice().sort((a, b) => ev[a] - ev[b])
  let pares = 0
  for (let i = 1; i < ord.length; i++) {
    if (ev[ord[i]] - ev[ord[i - 1]] < MIN_GAP_MS) { pares++; suspeitos.add(ord[i]); suspeitos.add(ord[i - 1]) }
  }
  if (pares) {
    const n = suspeitos.size
    problemas.push({
      nivel: pares >= 2 ? 'erro' : 'aviso',
      texto: `${n} horários com menos de 1 min entre si (${[...suspeitos].map((k) => MARCO_LABEL[k]).join(', ')}) — provável hora do clique, não do evento`,
    })
  }

  // fora de ordem
  const inversoes = []
  for (let i = 0; i < presentes.length; i++) {
    for (let j = i + 1; j < presentes.length; j++) {
      const a = presentes[i], b = presentes[j]
      if (MARCOS.indexOf(a) < MARCOS.indexOf(b) && ev[b] < ev[a]) inversoes.push([a, b])
    }
  }
  if (inversoes.length) {
    for (const [a, b] of inversoes) { suspeitos.add(a); suspeitos.add(b) }
    problemas.push({ nivel: 'erro', texto: `Fora de ordem: ${inversoes.slice(0, 2).map(([a, b]) => `"${MARCO_LABEL[b]}" antes de "${MARCO_LABEL[a]}"`).join('; ')}${inversoes.length > 2 ? '…' : ''}` })
  }

  // marcado em outro dia (reabriu caso antigo e tocou o marco agora)
  const ref = ev.decisao ?? ev[ord[0]]
  const longe = presentes.filter((k) => ev[k] - ref > DIA_MS)
  if (longe.length) {
    for (const k of longe) suspeitos.add(k)
    const dias = Math.round((Math.max(...longe.map((k) => ev[k])) - ref) / DIA_MS)
    problemas.push({ nivel: 'erro', texto: `${longe.length} horário${longe.length > 1 ? 's' : ''} ${dias} dia${dias > 1 ? 's' : ''} depois do acionamento (${longe.map((k) => MARCO_LABEL[k]).join(', ')})` })
  }

  const faltam = cancelado ? [] : MARCOS.filter((k) => ev[k] == null)
  if (faltam.length) {
    problemas.push({ nivel: 'aviso', texto: `Falta${faltam.length > 1 ? 'm' : ''}: ${faltam.map((k) => MARCO_LABEL[k]).join(', ')}` })
  }

  // como foi registrado: tocado na hora × lançado depois (digitado em minuto
  // cheio, ou gravado >15 min após o horário informado) × não confiável
  const marcado = c.marcado_em || {}
  let aoVivo = 0, depois = 0
  for (const k of presentes) {
    if (suspeitos.has(k)) continue
    const em = num(marcado[k])
    if ((em != null && em - ev[k] > TARDIO_MS) || ev[k] % 60_000 === 0) depois++
    else aoVivo++
  }

  const nivel = problemas.some((p) => p.nivel === 'erro') ? 'erro' : faltam.length ? 'parcial' : 'ok'
  return { nivel, ev, presentes, cancelado, faltam, problemas, suspeitos, aoVivo, depois }
}

// minutos entre dois marcos, ou null se não serve para a conta
function intervalo(d, de, ate, min, max) {
  const a = d.ev[de], b = d.ev[ate]
  if (a == null || b == null || d.suspeitos.has(de) || d.suspeitos.has(ate)) return null
  const m = (b - a) / 60_000
  return m >= min && m <= max ? m : null
}
export const etapaMin = (d, e) => intervalo(d, e.de, e.ate, 1, e.max)
export const totalMin = (d, t) => (d.nivel === 'erro' ? null : intervalo(d, t.de, t.ate, t.min, t.max))

// ---------- utilidades ----------
export function quantil(sorted, q) {
  if (!sorted.length) return null
  const p = (sorted.length - 1) * q
  const lo = Math.floor(p), hi = Math.ceil(p)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (p - lo)
}
export function resumo(vals) {
  const s = vals.filter((v) => v != null).sort((a, b) => a - b)
  if (!s.length) return { n: 0 }
  return { n: s.length, med: quantil(s, 0.5), p25: quantil(s, 0.25), p75: quantil(s, 0.75), p90: quantil(s, 0.9), min: s[0], max: s[s.length - 1] }
}

const TZ = 'America/Bahia'
const fmtParts = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false })
export function partesLocais(ms) {
  const p = Object.fromEntries(fmtParts.formatToParts(new Date(ms)).map((x) => [x.type, x.value]))
  return { ano: p.year, mes: p.month, dia: p.day, hora: Number(p.hour) % 24, semana: new Date(ms).toLocaleDateString('en-US', { timeZone: TZ, weekday: 'short' }) }
}

// município da cena: scenePlace, senão o trecho antes de "Bahia" no endereço
export function municipio(c) {
  if (c.cidade) return c.cidade
  const partes = String(c.scene_label || '').split(',').map((s) => s.trim())
  const i = partes.indexOf('Bahia')
  return i > 0 ? partes[i - 1] : 'Não informado'
}

function contar(itens, chave) {
  const m = new Map()
  for (const it of itens) {
    const ks = [].concat(chave(it)).filter((k) => k != null && k !== '')
    for (const k of ks) m.set(k, (m.get(k) || 0) + 1)
  }
  return [...m.entries()].map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n || String(a.label).localeCompare(String(b.label)))
}

const SEMANA = [['Mon', 'Seg'], ['Tue', 'Ter'], ['Wed', 'Qua'], ['Thu', 'Qui'], ['Fri', 'Sex'], ['Sat', 'Sáb'], ['Sun', 'Dom']]
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const FAIXAS_KM = [[0, 20, 'até 20 km'], [20, 40, '20–40 km'], [40, 60, '40–60 km'], [60, 100, '60–100 km'], [100, Infinity, '> 100 km']]

// ---------- agregação de um conjunto de casos ----------
// casos: já filtrados por período/exclusão. base: {lat, lon} da base do GOA.
export function aggregate(casos, { base } = {}) {
  const rows = casos.map((c) => {
    const d = diagnose(c)
    const quando = d.ev.decisao ?? new Date(c.created_at).getTime()
    const km = base && c.scene_lat != null && c.scene_lon != null ? haversineKm(base, { lat: c.scene_lat, lon: c.scene_lon }) : null
    return { c, d, quando, local: partesLocais(quando), km }
  })

  const etapas = ETAPAS.map((e) => {
    const vals = rows.map((r) => ({ id: r.c.id, ref: r.c.case_ref, m: etapaMin(r.d, e) })).filter((v) => v.m != null)
    return { ...e, ...resumo(vals.map((v) => v.m)), vals, comAmbos: rows.filter((r) => r.d.ev[e.de] != null && r.d.ev[e.ate] != null).length }
  })
  const totais = TOTAIS.map((t) => {
    const vals = rows.map((r) => ({ id: r.c.id, ref: r.c.case_ref, m: totalMin(r.d, t) })).filter((v) => v.m != null)
    return { ...t, ...resumo(vals.map((v) => v.m)), vals, comAmbos: rows.filter((r) => r.d.ev[t.de] != null && r.d.ev[t.ate] != null).length }
  })

  // real × estimativa do app no momento da decisão
  const total = TOTAIS.find((t) => t.id === 'total')
  const comparacao = rows
    .map((r) => ({ id: r.c.id, ref: r.c.case_ref, quando: r.quando, tag: r.c.tag, real: totalMin(r.d, total), aereo: num(r.c.air_total_min), terrestre: num(r.c.ground_total_min) }))
    .filter((x) => x.real != null && (x.aereo != null || x.terrestre != null))
  const comTerrestre = comparacao.filter((x) => x.terrestre != null)
  const ganho = resumo(comTerrestre.map((x) => x.terrestre - x.real))
  const errEst = resumo(comparacao.filter((x) => x.aereo != null).map((x) => x.real - x.aereo))
  const ganhoEst = resumo(rows.map((r) => (num(r.c.ground_total_min) != null && num(r.c.air_total_min) != null ? r.c.ground_total_min - r.c.air_total_min : null)))

  // tempo total por tipo de ocorrência
  const porTipo = contar(rows, (r) => r.c.tag || 'Sem tipo').map(({ label, n }) => {
    const rs = rows.filter((r) => (r.c.tag || 'Sem tipo') === label)
    return { label, n, total: resumo(rs.map((r) => totalMin(r.d, total))), ate_paciente: resumo(rs.map((r) => totalMin(r.d, TOTAIS[0]))) }
  })

  const meses = new Map()
  for (const r of rows) {
    const k = `${r.local.ano}-${r.local.mes}`
    meses.set(k, (meses.get(k) || 0) + 1)
  }
  const porMes = [...meses.keys()].sort().map((k) => ({ label: `${MESES[Number(k.slice(5)) - 1]}/${k.slice(2, 4)}`, n: meses.get(k) }))
  if (porMes.length > 1) { // meses sem caso entre o primeiro e o último também aparecem
    const [a0, m0] = [...meses.keys()].sort()[0].split('-').map(Number)
    const [a1, m1] = [...meses.keys()].sort().at(-1).split('-').map(Number)
    porMes.length = 0
    for (let a = a0, m = m0; a < a1 || (a === a1 && m <= m1); m === 12 ? (a++, m = 1) : m++) {
      const k = `${a}-${String(m).padStart(2, '0')}`
      porMes.push({ label: `${MESES[m - 1]}/${String(a).slice(2)}`, n: meses.get(k) || 0 })
    }
  }
  const porSemana = SEMANA.map(([en, pt]) => ({ label: pt, n: rows.filter((r) => r.local.semana === en).length }))
  const porHora = Array.from({ length: 24 }, (_, h) => ({ label: String(h).padStart(2, '0'), n: rows.filter((r) => r.local.hora === h).length }))
  const porDistancia = FAIXAS_KM.map(([a, b, label]) => ({ label, n: rows.filter((r) => r.km != null && r.km >= a && r.km < b).length }))

  const diag = { ok: 0, parcial: 0, erro: 0, vazio: 0 }
  const registro = { aoVivo: 0, depois: 0, suspeitos: 0 }
  for (const r of rows) {
    diag[r.d.nivel]++
    registro.aoVivo += r.d.aoVivo; registro.depois += r.d.depois; registro.suspeitos += r.d.suspeitos.size
  }

  return {
    n: rows.length,
    rows,
    concluidas: rows.filter((r) => r.d.ev.entrega != null || r.d.ev.livre != null).length,
    canceladas: rows.filter((r) => r.d.cancelado).length,
    comIntercorrencia: rows.filter((r) => r.c.interc > 0).length,
    gatesNaoOk: rows.filter((r) => r.c.gates_ok === false).length,
    etapas, totais, comparacao, ganho, errEst, ganhoEst,
    porTipo,
    porFaixa: ['red', 'yellow', 'green'].map((k) => ({ key: k, n: rows.filter((r) => r.c.band === k).length })),
    score: resumo(rows.map((r) => num(r.c.score))),
    porHospital: contar(rows, (r) => r.c.hospital || 'Não informado'),
    porMunicipio: contar(rows, (r) => municipio(r.c)),
    porCriterio: contar(rows, (r) => r.c.criterios || []),
    porAutor: contar(rows, (r) => r.c.autor || '—'),
    porMes, porSemana, porHora, porDistancia,
    distancia: resumo(rows.map((r) => r.km)),
    diag, registro,
  }
}

// pedidos feitos pela tela pública "Acionar GOA"
export function resumoAcionamentos(lista) {
  return {
    n: lista.length,
    completos: lista.filter((a) => a.completo).length,
    porTipo: contar(lista, (a) => a.tipo || 'Não informado'),
    porCentral: contar(lista, (a) => a.central || 'Não informada'),
    avisoOk: lista.filter((a) => a.wa_status === 'ok').length,
  }
}
