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
    if (legado || mesmaVersao) { data[k] = c; applied.push(k); continue }
    // base desconhecida para o campo: não dá para provar que o servidor não
    // mudou, então só entra direto se o servidor estiver vazio
    const temBase = base != null && Object.prototype.hasOwnProperty.call(base, k)
    const b = temBase ? norm(base[k]) : ''
    if (s === b) { data[k] = c; applied.push(k); continue }
    if (temBase && c === b) continue
    conflicts.push({ field: k, server_value: s, client_value: c, base_value: temBase ? b : null })
  }
  return { data, applied, conflicts }
}
