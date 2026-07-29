// Campos aceitos na ficha do paciente.
//
// A FORMA da ficha (seções, rótulos, tipos) mora em src/lib/patient.js, no
// front — é de lá que sai o formulário e o documento impresso. Esta lista é a
// contraparte do servidor e existe porque o back não importa de src/.
// Acrescentou campo lá? Acrescente aqui, senão ele é silenciosamente
// descartado na gravação.
//
// Serve de whitelist: sem ela o endpoint viraria depósito genérico de blob,
// aceitando qualquer chave que alguém resolvesse mandar.
export const PATIENT_KEYS = [
  // identificação
  'nome', 'nascimento', 'sexo', 'nomeMae', 'cpf', 'cns', 'municipio',
  // quadro clínico
  'queixa', 'pa', 'fc', 'fr', 'spo2', 'tax', 'hgt', 'gcs', 'dor',
  'alergias', 'comorbidades', 'medUso',
  // avaliação e conduta
  'hipotese', 'cid', 'risco', 'procedimentos', 'medicacoes', 'intercorrencias',
  // responsável
  'medico', 'crm', 'equipe',
]

const PERMITIDO = new Set(PATIENT_KEYS)
// textarea de intercorrências em transporte longo é o campo que mais cresce;
// 4000 caracteres é folgado para prontuário e barra abuso do endpoint
const MAX_LEN = 4000

// Devolve só o que é campo de ficha, já como string e com teto de tamanho.
// Valor vazio é mantido (é assim que se APAGA um campo pela tela ao vivo);
// quem não estiver na whitelist simplesmente não passa.
export function sanitizePatient(fields) {
  const out = {}
  for (const [k, v] of Object.entries(fields || {})) {
    if (!PERMITIDO.has(k)) continue
    out[k] = v == null ? '' : String(v).slice(0, MAX_LEN)
  }
  return out
}
