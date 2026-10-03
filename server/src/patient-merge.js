// Fusão de três pontas da ficha do paciente, campo a campo.
//
// O aparelho que ficou sem rede manda o que mudou (`changes`), como ele via
// cada campo na última sincronização (`base`) e a versão da ficha que ele
// tinha (`baseVersion`). Regra única: NADA é sobrescrito em silêncio.
//
//   - só o aparelho mudou o campo  → entra
//   - só o servidor mudou          → fica o do servidor
//   - os dois mudaram, iguais      → nada a fazer
//   - os dois mudaram, diferentes  → não entra; vira divergência para um
//                                    usuário escolher (case_patient_conflict)
//
// Cliente antigo (sem `baseVersion` nem `base`) segue como sempre foi: o que
// ele manda entra.
//
// Função pura, sem banco: é ela que os testes de unidade exercitam.
const norm = (v) => (v == null ? '' : String(v))

export function mergePatient({ server = {}, serverVersion = 0, base, baseVersion, changes = {} }) {
  const data = { ...server }
  const applied = []
  const conflicts = []
  const legado = baseVersion == null && base == null
  const mesmaVersao = baseVersion != null && Number(baseVersion) === Number(serverVersion)
  for (const [k, v] of Object.entries(changes)) {
    const c = norm(v)
    const s = norm(server[k])
    if (c === s) continue
    const aplica = () => { data[k] = c; applied.push(k) }
    if (legado) { aplica(); continue }
    if (base != null && Object.prototype.hasOwnProperty.call(base, k)) {
      // a base do CAMPO manda, mesmo com a versão em dia: a versão que o
      // aparelho conhece pode ser mais nova que a base que ele tem do campo
      const b = norm(base[k])
      if (s === b) aplica()
      else if (c !== b) conflicts.push({ field: k, server_value: s, client_value: c, base_value: b })
      continue
    }
    // sem base para o campo: só a versão em dia (ou servidor vazio) prova que
    // não há nada do outro lado para sobrescrever
    if (mesmaVersao || s === '') aplica()
    else conflicts.push({ field: k, server_value: s, client_value: c, base_value: null })
  }
  return { data, applied, conflicts }
}
