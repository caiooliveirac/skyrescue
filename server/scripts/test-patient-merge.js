// Testes de unidade da fusão de três pontas da ficha (src/patient-merge.js).
// Sem banco: `node scripts/test-patient-merge.js`. Valores fictícios.
import { mergePatient } from '../src/patient-merge.js'

let falhas = 0
const ok = (nome, cond) => {
  console.log(`${cond ? '  OK  ' : ' FALHA'} ${nome}`)
  if (!cond) falhas++
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// só o aparelho mudou
let r = mergePatient({
  server: { pa: '120x80', fc: '80' }, serverVersion: 3,
  base: { pa: '120x80' }, baseVersion: 2, changes: { pa: '90x60' },
})
ok('só o aparelho mudou: entra', r.data.pa === '90x60' && eq(r.applied, ['pa']) && r.conflicts.length === 0)
ok('só o aparelho mudou: o resto fica', r.data.fc === '80')

// só o servidor mudou (o aparelho reenviou o valor que já tinha)
r = mergePatient({
  server: { pa: '100x70' }, serverVersion: 3,
  base: { pa: '120x80' }, baseVersion: 2, changes: { pa: '120x80' },
})
ok('só o servidor mudou: fica o do servidor', r.data.pa === '100x70' && !r.applied.length && !r.conflicts.length)

// ambos mudaram para o mesmo valor
r = mergePatient({
  server: { fc: '110' }, serverVersion: 5,
  base: { fc: '80' }, baseVersion: 2, changes: { fc: '110' },
})
ok('ambos iguais: sem divergência e sem regravar', !r.applied.length && !r.conflicts.length && r.data.fc === '110')

// ambos mudaram para valores diferentes
r = mergePatient({
  server: { fc: '110', gcs: '15' }, serverVersion: 5,
  base: { fc: '80', gcs: '15' }, baseVersion: 2, changes: { fc: '130', gcs: '14' },
})
ok('ambos diferentes: campo não é aplicado', r.data.fc === '110')
ok('ambos diferentes: vira divergência com as três pontas',
  eq(r.conflicts, [{ field: 'fc', server_value: '110', client_value: '130', base_value: '80' }]))
ok('ambos diferentes: o campo sem disputa do mesmo envio entra', r.data.gcs === '14' && eq(r.applied, ['gcs']))

// campo apagado pelo aparelho
r = mergePatient({
  server: { alergias: 'dipirona' }, serverVersion: 4,
  base: { alergias: 'dipirona' }, baseVersion: 3, changes: { alergias: '' },
})
ok('apagado só no aparelho: apaga', r.data.alergias === '' && eq(r.applied, ['alergias']))
r = mergePatient({
  server: { alergias: 'dipirona, AAS' }, serverVersion: 4,
  base: { alergias: 'dipirona' }, baseVersion: 3, changes: { alergias: '' },
})
ok('apagado no aparelho e alterado no servidor: divergência, nada some',
  r.data.alergias === 'dipirona, AAS' && r.conflicts[0]?.client_value === '' && r.conflicts[0]?.server_value === 'dipirona, AAS')
// campo apagado no servidor e alterado no aparelho
r = mergePatient({
  server: { alergias: '' }, serverVersion: 4,
  base: { alergias: 'dipirona' }, baseVersion: 3, changes: { alergias: 'dipirona, AAS' },
})
ok('apagado no servidor e alterado no aparelho: divergência',
  r.data.alergias === '' && r.conflicts.length === 1 && r.conflicts[0].server_value === '')

// mesma versão: caminho rápido, entra tudo
r = mergePatient({
  server: { pa: '120x80' }, serverVersion: 2,
  base: { pa: '120x80' }, baseVersion: 2, changes: { pa: '90x60', fr: '20' },
})
ok('mesma versão: aplica direto', r.data.pa === '90x60' && r.data.fr === '20' && r.applied.length === 2)

// reenvio do mesmo envio depois de aplicado (resposta perdida): o servidor já
// tem os valores do aparelho — nada muda e nada vira divergência. (A rota
// ainda barra pelo opId antes de chegar aqui; isto é a segunda defesa.)
const envio = { base: { pa: '120x80' }, baseVersion: 2, changes: { pa: '90x60' } }
const primeiro = mergePatient({ server: { pa: '120x80' }, serverVersion: 2, ...envio })
r = mergePatient({ server: primeiro.data, serverVersion: 3, ...envio })
ok('reenvio do mesmo envio: idempotente', !r.applied.length && !r.conflicts.length && r.data.pa === '90x60')

// aparelho que nunca viu ficha (baseVersion 0) e o servidor já tem uma
r = mergePatient({
  server: { queixa: 'queda' }, serverVersion: 1,
  base: { queixa: '', hipotese: '' }, baseVersion: 0, changes: { queixa: 'colisão', hipotese: 'TCE' },
})
ok('ficha criada nos dois lados: campo em disputa vira divergência, o outro entra',
  r.data.queixa === 'queda' && r.data.hipotese === 'TCE' && r.conflicts.length === 1)

// campo sem base conhecida e servidor preenchido: não sobrescreve
r = mergePatient({ server: { cid: 'S06' }, serverVersion: 4, base: {}, baseVersion: 1, changes: { cid: 'S09' } })
ok('sem base para o campo: divergência, não sobrescreve',
  r.data.cid === 'S06' && r.conflicts[0]?.base_value === null)

// cliente antigo: sem baseVersion nem base → como sempre foi
r = mergePatient({ server: { pa: '100x70' }, serverVersion: 9, changes: { pa: '90x60' } })
ok('cliente antigo (sem baseVersion): aplica como hoje', r.data.pa === '90x60' && !r.conflicts.length)

console.log(falhas ? `\n${falhas} falha(s)` : '\ntudo certo')
process.exit(falhas ? 1 : 0)
