// ------------------------------------------------------------------
// Aeronave e equipe do voo.
//
// Fica no snapshot do caso (`crew`), não na ficha do paciente: é dado da
// equipe, não do paciente, e precisa chegar ao briefing do grupo e ao
// relatório para o GOA — onde a ficha nunca vai. Cada posição guarda uma
// cópia {nome, reg}: o cadastro (tabela crew_member) é só de onde a tela
// escolhe, e editá-lo depois não reescreve missões passadas.
// ------------------------------------------------------------------

// `kind` = de qual lista do cadastro a posição escolhe (piloto serve de
// comandante e de copiloto). req = cobrado na documentação depois do
// acionamento (ver lib/pendencias.js).
export const CREW_SLOTS = [
  { k: 'aeronave', label: 'Aeronave (prefixo)', kind: 'aeronave', reg: 'modelo' },
  { k: 'comandante', label: 'Comandante', kind: 'piloto', reg: 'CANAC', req: true },
  { k: 'copiloto', label: 'Copiloto', kind: 'piloto', reg: 'CANAC' },
  { k: 'tripulante', label: 'Operador aerotático', kind: 'tripulante', reg: 'matrícula' },
  { k: 'tripulante2', label: '2º operador aerotático', kind: 'tripulante', reg: 'matrícula' },
  { k: 'medico', label: 'Médico de bordo', kind: 'medico', reg: 'CRM/UF', req: true },
  { k: 'enfermeiro', label: 'Enfermeiro de bordo', kind: 'enfermeiro', reg: 'COREN/UF' },
]

// funções do cadastro, na ordem em que aparecem
export const CREW_KINDS = [
  { kind: 'aeronave', label: 'Aeronaves', one: 'Aeronave', name: 'Prefixo / indicativo', reg: 'Modelo' },
  { kind: 'piloto', label: 'Pilotos', one: 'Piloto', name: 'Nome', reg: 'CANAC' },
  { kind: 'tripulante', label: 'Operadores aerotáticos', one: 'Operador aerotático', name: 'Nome', reg: 'Matrícula' },
  { kind: 'medico', label: 'Médicos', one: 'Médico', name: 'Nome', reg: 'CRM/UF' },
  { kind: 'enfermeiro', label: 'Enfermeiros', one: 'Enfermeiro', name: 'Nome', reg: 'COREN/UF' },
]

const txt = (v) => String(v ?? '').trim()
export const slotNome = (crew, k) => txt(crew?.[k]?.nome)

export function crewFilled(crew) {
  return Boolean(crew) && (CREW_SLOTS.some((s) => slotNome(crew, s.k)) || txt(crew.outros) !== '')
}

// "Nome — CRM 123" (ou só o nome)
const comReg = (v) => [txt(v?.nome), txt(v?.reg)].filter(Boolean).join(' — ')

// linhas [rótulo, valor] para o PDF e o resumo; só o que foi preenchido
export function crewLinhas(crew) {
  if (!crew) return []
  const out = CREW_SLOTS.filter((s) => slotNome(crew, s.k)).map((s) => [s.label.replace(' (prefixo)', ''), comReg(crew[s.k])])
  if (txt(crew.outros)) out.push(['Outros a bordo', txt(crew.outros)])
  return out
}
