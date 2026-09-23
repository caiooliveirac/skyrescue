// ------------------------------------------------------------------
// O que falta para o caso ficar DOCUMENTADO — não para decidir.
//
// A decisão de acionar nunca espera papel: nada aqui bloqueia salvar, marcar
// horário ou acionar o grupo. A lista aparece para quem preenche (card
// "Documentação do caso", selos no hub, campos com *) e sai impressa no PDF
// enquanto não zerar, para a cobrança ser visível também no papel.
//
// `onde` = tela do celular em que o item se resolve (ver VIEWS no App).
// ------------------------------------------------------------------
import { PATIENT_SECTIONS } from './patient.js'
import { MILESTONES } from '../components/Tracking.jsx'

const vazio = (v) => String(v ?? '').trim() === ''
export const REQ_PACIENTE = PATIENT_SECTIONS.flatMap((s) => s.fields.filter((f) => f.req))

export function pendencias({ scene, hits, gates, gateJust, patient, events }) {
  const out = []
  if (!scene) out.push({ id: 'cena', label: 'Local da ocorrência', onde: 'caso' })
  if (!hits.length) out.push({ id: 'criterios', label: 'Critérios de gravidade (nenhum marcado)', onde: 'caso' })
  for (const g of gates.rows) {
    if (g.override && vazio(gateJust?.[g.id])) {
      out.push({ id: 'just_' + g.id, label: `Justificativa de "${g.label}" forçado ${g.override === 'ok' ? 'OK' : 'NÃO'}`, onde: 'fatores' })
    }
  }
  for (const f of REQ_PACIENTE) {
    if (vazio(patient?.[f.k])) out.push({ id: 'p_' + f.k, label: `Paciente: ${f.label}`, onde: 'paciente' })
  }
  // horários só são cobrados depois que houve acionamento — caso que ficou no
  // terrestre não tem voo para documentar
  if (events?.decisao) {
    for (const m of MILESTONES) {
      if (!events[m.id]) out.push({ id: 'h_' + m.id, label: `Horário: ${m.label}`, onde: 'missao' })
    }
  }
  return out
}
