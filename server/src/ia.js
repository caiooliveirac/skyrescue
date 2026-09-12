// Sugestão de critérios de gravidade / centro especializado a partir da
// história do paciente, com a API da Anthropic.
//
// PII: o front monta a "história" só com queixa, hipótese, sinais vitais,
// comorbidades, sexo e idade — nome, CPF, CNS, nome da mãe e endereço nunca
// entram. O que vai para a API é o texto clínico, mais o catálogo de opções
// (ids + rótulos) que o próprio front envia: o servidor não duplica score.js.
//
// Sem ANTHROPIC_API_KEY o endpoint responde 503 e o botão some do app.
import Anthropic from '@anthropic-ai/sdk'

// ponytail: Sonnet 5 é barato nesta escala (~1,5k tokens por chamada) e
// julga quadro clínico melhor que Haiku; troque por IA_MODEL no .env
const MODEL = process.env.IA_MODEL || 'claude-sonnet-5'
let client = null
export const iaDisponivel = () => !!process.env.ANTHROPIC_API_KEY

const SYSTEM = `Você apoia o médico regulador do SAMU 192 Salvador na avaliação de acionamento aeromédico (helicóptero do GOA/CBMBA).
Dada a história clínica resumida do paciente, escolha, ENTRE AS OPÇÕES FORNECIDAS, os critérios de gravidade que a história sustenta e a necessidade de centro especializado.
Regras:
- Só marque um critério quando a história o sustenta explicitamente ou por inferência clínica forte; na dúvida, não marque.
- Use apenas ids que estão na lista de opções.
- Justificativa curta (até 3 frases), em português, citando os achados que levaram a cada critério.
- Se a história for insuficiente, devolva listas vazias e diga na justificativa o que falta perguntar ao solicitante.
Isto é apoio à decisão: quem decide é o médico regulador.`

const SCHEMA = {
  type: 'object',
  properties: {
    criterios: { type: 'array', items: { type: 'string' }, description: 'ids das opções de gravidade sustentadas pela história' },
    centro: { type: 'array', items: { type: 'string' }, description: 'ids das opções de centro especializado necessárias' },
    justificativa: { type: 'string' },
    faltam: { type: 'array', items: { type: 'string' }, description: 'perguntas que fariam diferença e a história não responde' },
  },
  required: ['criterios', 'centro', 'justificativa', 'faltam'],
  additionalProperties: false,
}

// historia: texto (<= 4000 chars); opcoes: [{id, label, grupo}]
export async function sugerirCriterios(historia, opcoes) {
  if (!iaDisponivel()) { const e = new Error('IA não configurada (ANTHROPIC_API_KEY)'); e.status = 503; throw e }
  client ||= new Anthropic()
  const validos = new Set(opcoes.map((o) => o.id))
  const lista = opcoes.map((o) => `- ${o.id}: ${o.label}${o.grupo ? ` [${o.grupo}]` : ''}`).join('\n')
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: SYSTEM,
    messages: [{
      role: 'user',
      content: `OPÇÕES (id: rótulo [grupo]):\n${lista}\n\nHISTÓRIA DO PACIENTE:\n${historia}`,
    }],
    output_config: { format: { type: 'json_schema', schema: SCHEMA } },
  })
  if (res.stop_reason === 'refusal') { const e = new Error('a IA recusou avaliar este caso'); e.status = 422; throw e }
  const texto = res.content.find((b) => b.type === 'text')?.text || '{}'
  let out
  try { out = JSON.parse(texto) } catch (e) { throw new Error('resposta da IA fora do formato') }
  // nunca confiar em id que não veio do catálogo do app
  return {
    criterios: (out.criterios || []).filter((id) => validos.has(id)),
    centro: (out.centro || []).filter((id) => validos.has(id)),
    justificativa: String(out.justificativa || '').slice(0, 1200),
    faltam: (out.faltam || []).map((s) => String(s).slice(0, 200)).slice(0, 6),
    modelo: MODEL,
    tokens: { in: res.usage?.input_tokens ?? null, out: res.usage?.output_tokens ?? null },
  }
}
