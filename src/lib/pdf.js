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
import { MILESTONES } from '../components/Tracking.jsx'
import { wxHora } from '../components/Results.jsx'

// grupo, título, se vem marcada no padrão
export const PRINT_SECTIONS = [
  { id: 'ocorrencia', grupo: 'voo', title: 'Ocorrência', padrao: true },
  { id: 'score', grupo: 'voo', title: 'Pontuação e critérios', padrao: true },
  { id: 'tempos', grupo: 'voo', title: 'Tempos e destino', padrao: true },
  { id: 'pouso', grupo: 'voo', title: 'Pouso (LZ e heliponto)', padrao: true },
  { id: 'condicoes', grupo: 'voo', title: 'Meteorologia e gates', padrao: false },
  { id: 'cronologia', grupo: 'voo', title: 'Cronologia da missão', padrao: true },
  { id: 'intercorrencias', grupo: 'voo', title: 'Intercorrências do voo', padrao: true },
  { id: 'obs', grupo: 'voo', title: 'Observações', padrao: true },
  { id: 'p_ident', grupo: 'paciente', title: 'Identificação', padrao: true },
  { id: 'p_docs', grupo: 'paciente', title: 'Documentos (CPF, CNS, mãe)', padrao: false },
  { id: 'p_clinico', grupo: 'paciente', title: 'Quadro clínico', padrao: true },
  { id: 'p_conduta', grupo: 'paciente', title: 'Avaliação e conduta', padrao: true },
  { id: 'assinatura', grupo: 'doc', title: 'Assinatura (médico / gov.br)', padrao: true },
]

export const PRINT_PRESETS = [
  { id: 'padrao', label: 'Padrão', ids: PRINT_SECTIONS.filter((s) => s.padrao).map((s) => s.id) },
  { id: 'completo', label: 'Completo', ids: PRINT_SECTIONS.map((s) => s.id) },
  { id: 'voo', label: 'Só voo', ids: PRINT_SECTIONS.filter((s) => s.grupo !== 'paciente').map((s) => s.id) },
  { id: 'paciente', label: 'Só paciente', ids: PRINT_SECTIONS.filter((s) => s.grupo !== 'voo').map((s) => s.id) },
]

// ---------------- conteúdo ----------------
const val = (v) => (v == null ? '' : String(v).trim())
const rows = (...pares) => pares.filter(([, v]) => val(v)).map(([k, v]) => [k, val(v)])
const hhmm = (ms) => new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

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
  return {
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
    cronologia: rows(...MILESTONES.map((mi) => [mi.label, c.events[mi.id] ? hhmm(c.events[mi.id]) : ''])),
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
      ['Equipe de transporte', p.equipe],
    ),
    // a assinatura sempre "tem conteúdo": é o campo em branco para assinar
    assinatura: [['Médico', [p.medico || c.medico, p.crm].filter(Boolean).join(' — ') || 'Médico regulador']],
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

  const grupos = { voo: 'Voo', paciente: 'Paciente' }
  let grupoAtual = null
  for (const s of PRINT_SECTIONS) {
    if (!sel.includes(s.id)) continue
    const linhas = conteudo[s.id] || []
    if (!linhas.length) continue
    if (s.id === 'assinatura') {
      if (y > 250) { doc.addPage(); y = 20 }
      y += 22
      doc.line(M, y, M + 90, y)
      doc.setFont('helvetica', 'normal').setFontSize(10).text(pdfText(linhas[0][1]), M, y + 5)
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
      margin: { left: M, right: M },
      head: [[{ content: pdfText(s.title), colSpan: 2 }]],
      body: linhas.map(([k, v]) => [pdfText(k), pdfText(v)]),
      theme: 'grid',
      styles: { font: 'helvetica', fontSize: 9, cellPadding: 1.8, lineColor: 190, lineWidth: 0.2, textColor: 20 },
      headStyles: { fillColor: [235, 240, 245], textColor: 20, fontStyle: 'bold' },
      columnStyles: { 0: { cellWidth: 52, fontStyle: 'bold' } },
      rowPageBreak: 'avoid',
    })
    y = doc.lastAutoTable.finalY + 3
  }

  doc.setFont('helvetica', 'normal').setFontSize(7).setTextColor(110)
  const rodape = doc.splitTextToSize(pdfText('Documento de apoio à decisão gerado pelo SkyRescue β. Estimativas indicativas; decisão final: médico regulador e comandante da aeronave.'), W - 2 * M)
  if (y > 280) { doc.addPage(); y = 20 }
  doc.text(rodape, M, y + 4)

  doc.setProperties({ title: `SkyRescue ${meta.caseId || 'caso'}` })
  return doc.output('blob')
}
