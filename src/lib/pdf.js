// ------------------------------------------------------------------
// Impressão do caso em PDF, com escolha do que sai.
//
// Um documento só para o voo e para o paciente: cada bloco é uma seção que
// quem imprime marca ou desmarca no modal (PrintModal). O PDF é gerado no
// próprio aparelho (jsPDF) e aberto no navegador — no celular vai direto ao
// visualizador de PDF, sem passar pelo diálogo de impressão.
//
// Linha sem valor não entra (pedido de 22/07: o documento não fica poluído
// de "—"); seção sem nenhuma linha aparece desabilitada no modal.
// ------------------------------------------------------------------
import { fmtMin, fmtClock, fmtCoords, fmtCoordsDDM } from './geo.js'
import { ageFrom } from './patient.js'
import { MILESTONES, CANCELADO } from '../components/Tracking.jsx'
import { wxHora } from '../components/Results.jsx'

// grupo, título, se vem marcada no padrão
export const PRINT_SECTIONS = [
  { id: 'pendencias', grupo: 'doc', title: 'Pendências de documentação', padrao: true },
  { id: 'responsaveis', grupo: 'doc', title: 'Responsáveis', padrao: true },
  { id: 'ocorrencia', grupo: 'voo', title: 'Ocorrência', padrao: true },
  { id: 'score', grupo: 'voo', title: 'Pontuação e critérios', padrao: true },
  { id: 'tempos', grupo: 'voo', title: 'Tempos e destino', padrao: true },
  { id: 'trechos', grupo: 'voo', title: 'Tempos por trecho (estimados)', padrao: true },
  { id: 'pouso', grupo: 'voo', title: 'Pouso (LZ e heliponto)', padrao: true },
  { id: 'condicoes', grupo: 'voo', title: 'Meteorologia e gates', padrao: false },
  { id: 'cronologia', grupo: 'voo', title: 'Cronologia da missão', padrao: true },
  { id: 'intervalos', grupo: 'voo', title: 'Intervalos da missão', padrao: true },
  { id: 'intercorrencias', grupo: 'voo', title: 'Intercorrências do voo', padrao: true },
  { id: 'obs', grupo: 'voo', title: 'Observações', padrao: true },
  { id: 'p_ident', grupo: 'paciente', title: 'Identificação', padrao: true },
  { id: 'p_docs', grupo: 'paciente', title: 'Documentos (CPF, CNS, mãe)', padrao: false },
  { id: 'p_clinico', grupo: 'paciente', title: 'Quadro clínico', padrao: true },
  { id: 'p_conduta', grupo: 'paciente', title: 'Avaliação e conduta', padrao: true },
  { id: 'assinatura', grupo: 'doc', title: 'Assinaturas (médico e comandante)', padrao: true },
]

export const PRINT_PRESETS = [
  { id: 'padrao', label: 'Padrão', ids: PRINT_SECTIONS.filter((s) => s.padrao).map((s) => s.id) },
  { id: 'completo', label: 'Completo', ids: PRINT_SECTIONS.map((s) => s.id) },
  { id: 'voo', label: 'Só voo', ids: PRINT_SECTIONS.filter((s) => s.grupo !== 'paciente').map((s) => s.id) },
  { id: 'paciente', label: 'Só paciente', ids: PRINT_SECTIONS.filter((s) => s.grupo !== 'voo').map((s) => s.id) },
]
// Relatório para os bombeiros do GOA: o voo, sem nada do paciente. Fica de
// fora também o texto livre das observações (pode citar o paciente), as
// pendências internas de documentação e as assinaturas.
export const PRINT_GOA = ['responsaveis', 'ocorrencia', 'score', 'tempos', 'trechos', 'pouso', 'condicoes', 'cronologia', 'intervalos', 'intercorrencias']

// ---------------- conteúdo ----------------
const val = (v) => (v == null ? '' : String(v).trim())
const rows = (...pares) => pares.filter(([, v]) => val(v)).map(([k, v]) => [k, val(v)])
const hhmm = (ms) => new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
const STATUS = { ok: 'OK', warn: 'ATENÇÃO', fail: 'IMPEDITIVO' }
// intervalos que a gestão acompanha, entre marcos da cronologia
const INTERVALOS = [
  ['decisao', 'decolagem', 'Resposta (acionamento → decolagem)'],
  ['decolagem', 'pouso_cena', 'Deslocamento até a cena'],
  ['pouso_cena', 'decolagem2', 'Tempo na cena'],
  ['decolagem2', 'pouso_destino', 'Transporte aéreo ao destino'],
  ['pouso_destino', 'entrega', 'Passagem ao hospital'],
  ['decisao', 'entrega', 'Total (acionamento → paciente acolhido)'],
]
const ONDE_PEND = { caso: 'caso', fatores: 'gates', paciente: 'ficha do paciente', missao: 'horários' }
const MISSAO = { ativa: 'acionado (missão em curso)', encerrada: 'acionado (missão encerrada)' }

// Monta { id: [[rótulo, valor], ...] } a partir do estado do caso.
export function printContent(c) {
  const p = c.patient || {}
  const hits = Object.values(c.score.perSection).flatMap((s) => s.hits)
  const m = c.mission
  const coord = (pt) => (pt ? `${fmtCoordsDDM(pt)} (dec ${fmtCoords(pt)})` : '')
  const nasc = p.nascimento ? new Date(p.nascimento + 'T00:00:00').toLocaleDateString('pt-BR') : ''
  const vitais = [
    p.pa && `PA ${p.pa}`, p.fc && `FC ${p.fc}`, p.fr && `FR ${p.fr}`,
    p.spo2 && `SpO2 ${p.spo2}%`, p.tax && `Tax ${p.tax} °C`, p.hgt && `HGT ${p.hgt}`,
    p.gcs && `GCS ${p.gcs}`, p.dor && `Dor ${p.dor}/10`,
  ].filter(Boolean).join(' · ')
  const w = c.wxScene
  const reg = c.registro || {}
  const por = (id) => reg.events_by?.[id]?.by
  const forcados = c.gates.rows.filter((g) => g.override)
  const km = (v) => (v != null ? ` · ${Number(v).toFixed(1)} km` : '')
  const g = m?.ground
  return {
    // agrupadas pela tela onde se resolvem — uma linha por item enchia meia página
    pendencias: Object.entries((c.pend || []).reduce((acc, x) => {
      (acc[x.onde] ||= []).push(x.label.replace(/^(Paciente|Horário): /, ''))
      return acc
    }, {})).map(([onde, itens]) => [`Falta (${ONDE_PEND[onde] || onde})`, itens.join('; ')]),
    responsaveis: rows(
      ['Caso aberto por', reg.created_by_name],
      ['Última alteração por', reg.updated_by_name],
      ['Acionamento autorizado por', por('decisao')],
      ['Médico regulador', [p.medico || c.medico, p.crm].filter(Boolean).join(' — ')],
      ['Equipe de transporte', p.equipe],
      ['Grupo da missão (Telegram)', c.events?.decisao || c.missionStatus ? (MISSAO[c.missionStatus] || 'não acionado') : ''],
    ),
    ocorrencia: rows(
      ['Local', c.sceneLabel],
      ['Caso', c.tag],
      ['Coordenadas', coord(c.scene)],
    ),
    score: rows(
      ['Score', `${c.score.total} pts — ${c.score.band.label}`],
      ['Critérios marcados', hits.join('; ') || 'nenhum'],
      ['Recomendação', c.rec ? c.rec.title : ''],
      ['Impeditivos', c.gates.ok ? '' : c.gates.fails.map((f) => f.label).join('; ')],
      ...forcados.map((gt) => [
        `Alterado manualmente: ${gt.label}`,
        `automático ${STATUS[gt.status] || 'SEM DADO'} → forçado ${gt.override === 'ok' ? 'OK' : 'NÃO'}. Justificativa: ${val(c.gateJust?.[gt.id]) || 'NÃO INFORMADA'}`,
      ]),
    ),
    trechos: rows(
      ['Base de saída', c.baseName],
      ...(m?.legs || []).filter((l) => l.min != null).map((l) => [l.label, `${fmtMin(l.min)}${km(l.km)}`]),
      ['Ambulância (terrestre)', c.usa],
      ['Atendimento na cena (terrestre)', g?.toHospMin != null ? fmtMin(g.cenaMin) : ''],
      ['Rota cena → hospital (terrestre)', g?.toHospMin != null ? `${fmtMin(g.toHospMin)}${km(g.distKm)}${g.traffic ? ' · com trânsito' : ''}` : ''],
    ),
    tempos: rows(
      ['Meio de transporte', c.meio],
      ['Aeromédico (total)', m?.airTotal != null ? fmtMin(m.airTotal) : ''],
      ['Terrestre (total)', m?.ground?.total != null ? fmtMin(m.ground.total) : ''],
      ['Diferença', m?.delta != null ? (m.delta > 0 ? `aéreo ${fmtMin(m.delta)} mais rápido` : `terrestre ${fmtMin(-m.delta)} mais rápido`) : ''],
      ['Destino', c.hospital ? c.destinoLabel : ''],
    ),
    pouso: rows(
      ['LZ', c.lzPoint ? `${c.manualLz ? 'Manual' : c.lzPoint.name} — ${coord(c.lzPoint)}` : ''],
      ['Heliponto de desembarque', c.landingHelipad ? `${c.landingHelipad.name} — ${coord(c.landingHelipad)}` : ''],
    ),
    condicoes: rows(
      [`Meteorologia (cena)${w?.at ? ' · aferida ' + wxHora(w) : ''}`, w ? `vento ${Math.round(w.windKmh || 0)} km/h · rajadas ${Math.round(w.gustKmh || 0)} km/h · vis ${w.visM != null ? (w.visM / 1000).toFixed(1) + ' km' : 's/ dado'} · precip ${w.precip ?? '—'} mm/h` : ''],
      ['METAR SBSV', c.metar],
      ['Janela diurna', c.daylight?.note],
      ['Gates', c.gates.rows.map((g) => `${g.label}: ${g.effective.toUpperCase()}`).join(' · ')],
    ),
    cronologia: rows(...[...MILESTONES, CANCELADO].map((mi) => [mi.label, c.events[mi.id] ? `${hhmm(c.events[mi.id])}${por(mi.id) ? ' · por ' + por(mi.id) : ''}` : ''])),
    intervalos: rows(...INTERVALOS.map(([a, b, label]) => {
      const ta = c.events[a], tb = c.events[b]
      return [label, ta && tb && tb >= ta ? fmtMin(Math.round((tb - ta) / 60000)) : '']
    })),
    intercorrencias: rows(...(c.intercorrencias || []).map((i) => [
      `${fmtClock(i.at)}${i.fase ? ` · após ${MILESTONES.find((mi) => mi.id === i.fase)?.label || i.fase}` : ''}`, i.texto,
    ])),
    obs: rows(['Observações', c.notes]),
    p_ident: rows(
      ['Nome', p.nome],
      ['Nascimento / idade', [nasc, ageFrom(p.nascimento)].filter(Boolean).join(' · ')],
      ['Sexo', p.sexo],
      ['Município', p.municipio],
    ),
    p_docs: rows(['Nome da mãe', p.nomeMae], ['CPF', p.cpf], ['CNS (Cartão SUS)', p.cns]),
    p_clinico: rows(
      ['Queixa / mecanismo', p.queixa],
      ['Sinais vitais', vitais],
      ['Alergias', p.alergias],
      ['Comorbidades', p.comorbidades],
      ['Medicação em uso', p.medUso],
    ),
    p_conduta: rows(
      ['Hipótese diagnóstica', p.hipotese],
      ['CID-10', p.cid],
      ['Classificação de risco', p.risco],
      ['Procedimentos realizados', p.procedimentos],
      ['Medicações administradas', p.medicacoes],
      ['Intercorrências no transporte', p.intercorrencias],
    ),
    // a assinatura sempre "tem conteúdo": é o campo em branco para assinar
    assinatura: [
      ['Médico', [p.medico || c.medico, p.crm].filter(Boolean).join(' — ') || 'Médico regulador'],
      ['Comandante', 'Comandante da aeronave (GOA/CBMBA)'],
    ],
  }
}

// ---------------- PDF ----------------
// As fontes padrão do PDF (Helvetica) só cobrem o WinAnsi/Latin-1: acentos
// do português passam, mas "₂", "Δ", "≥", emoji etc. sairiam como lixo.
const CP1252 = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'
const TROCA = { '₂': '2', 'Δ': 'dif. ', '≥': '>=', '≤': '<=', '→': '->', 'β': 'beta' }
const pdfText = (s) => Array.from(String(s ?? '').normalize('NFC'))
  .map((ch) => TROCA[ch] ?? ((ch.charCodeAt(0) <= 0xff || CP1252.includes(ch)) ? ch : ''))
  .join('')

// Gera o PDF e devolve um Blob. `sel` = ids das seções marcadas.
export async function gerarPdf(conteudo, sel, meta) {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const M = 14
  const W = doc.internal.pageSize.getWidth()
  let y = 16

  doc.setFont('helvetica', 'bold').setFontSize(14)
  doc.text(pdfText('SkyRescue — Registro de acionamento aeromédico'), M, y)
  y += 6
  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(80)
  const linhaMeta = [
    'SAMU 192 Salvador × GOA/CBMBA',
    meta.caseId && `Caso ${meta.caseId}`,
    `Avaliação ${new Date(meta.refMs).toLocaleString('pt-BR')}${meta.refFrozen ? '' : ' (em curso)'}`,
    `Emitido ${new Date().toLocaleString('pt-BR')}`,
  ].filter(Boolean).join(' · ')
  const metaLines = doc.splitTextToSize(pdfText(linhaMeta), W - 2 * M)
  doc.text(metaLines, M, y)
  y += metaLines.length * 4 + 2
  doc.setTextColor(0)

  // prontuário com campo em disputa (editado no servidor e num aparelho sem
  // rede): o documento sai, mas avisando que ainda pode mudar
  if (meta.divergencias > 0) {
    doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(180, 0, 0)
    const aviso = doc.splitTextToSize(pdfText(
      `ATENÇÃO: ${meta.divergencias} divergência(s) pendente(s) no prontuário deste caso. ` +
      'Há campo(s) da ficha do paciente com dois valores registrados aguardando decisão da equipe; ' +
      'este documento traz o valor atual do servidor e pode ser alterado.'), W - 2 * M)
    doc.text(aviso, M, y + 2)
    y += aviso.length * 4 + 4
    doc.setFont('helvetica', 'normal').setTextColor(0)
  }

  const grupos = { voo: 'Voo', paciente: 'Paciente' }
  let grupoAtual = null
  for (const s of PRINT_SECTIONS) {
    if (!sel.includes(s.id)) continue
    const linhas = conteudo[s.id] || []
    if (!linhas.length) continue
    if (s.id === 'assinatura') {
      if (y > 250) { doc.addPage(); y = 20 }
      y += 22
      const col = (W - 2 * M - 10) / 2
      doc.setFont('helvetica', 'normal').setFontSize(10)
      linhas.forEach(([, nome], i) => {
        const x = M + i * (col + 10)
        doc.line(x, y, x + col, y)
        doc.text(doc.splitTextToSize(pdfText(nome), col), x, y + 5)
      })
      doc.setFontSize(8).setTextColor(90)
      const nota = doc.splitTextToSize(pdfText('Documento emitido para assinatura eletrônica no gov.br (assinador.iti.br): faça o upload deste PDF e assine com sua conta gov.br.'), W - 2 * M)
      doc.text(nota, M, y + 11)
      doc.setTextColor(0)
      y += 11 + nota.length * 3.5
      continue
    }
    if (s.grupo !== grupoAtual && grupos[s.grupo]) {
      grupoAtual = s.grupo
      if (y > 260) { doc.addPage(); y = 20 }
      y += 4
      doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(10, 90, 110)
      doc.text(pdfText(grupos[s.grupo].toUpperCase()), M, y)
      doc.setTextColor(0)
      y += 2
    }
    // título de seção sozinho no pé da página, com as linhas na seguinte, não
    if (y > doc.internal.pageSize.getHeight() - 35) { doc.addPage(); y = 14 }
    autoTable(doc, {
      startY: y + 2,
      margin: { left: M, right: M, bottom: 16 },
      head: [[{ content: pdfText(s.title), colSpan: 2 }]],
      body: linhas.map(([k, v]) => [pdfText(k), pdfText(v)]),
      theme: 'grid',
      styles: { font: 'helvetica', fontSize: 9, cellPadding: 1.8, lineColor: 190, lineWidth: 0.2, textColor: 20 },
      headStyles: s.id === 'pendencias'
        ? { fillColor: [253, 230, 200], textColor: [120, 50, 0], fontStyle: 'bold' }
        : { fillColor: [235, 240, 245], textColor: 20, fontStyle: 'bold' },
      columnStyles: { 0: { cellWidth: 52, fontStyle: 'bold' } },
      rowPageBreak: 'avoid',
    })
    y = doc.lastAutoTable.finalY + 3
  }

  doc.setFont('helvetica', 'normal').setFontSize(7).setTextColor(110)
  const rodape = doc.splitTextToSize(pdfText('Documento de apoio à decisão gerado pelo SkyRescue β. Estimativas indicativas; decisão final: médico regulador e comandante da aeronave.'), W - 2 * M)
  if (y > 280) { doc.addPage(); y = 20 }
  doc.text(rodape, M, y + 4)

  // rodapé em toda página: folha solta de um documento impresso tem que dizer
  // de qual caso é
  const n = doc.getNumberOfPages()
  const H = doc.internal.pageSize.getHeight()
  for (let i = 1; i <= n; i++) {
    doc.setPage(i)
    doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(110)
    doc.text(pdfText(`SkyRescue${meta.caseId ? ' · Caso ' + meta.caseId : ''}`), M, H - 8)
    doc.text(`pág. ${i}/${n}`, W - M, H - 8, { align: 'right' })
  }

  doc.setProperties({ title: `SkyRescue ${meta.caseId || 'caso'}` })
  return doc.output('blob')
}
