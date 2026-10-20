// Teste do card "Aeronave e equipe" (src/lib/crew.js): o registro profissional
// acompanha o nome. Sem banco, sem rede, dados fictícios:  node scripts/test-crew.js
import assert from 'node:assert/strict'
import { slotPorNome, crewLinhas } from '../src/lib/crew.js'

const ROSTER = [
  { id: 1, kind: 'medico', name: 'Dra. Fulana Teste', reg: 'CRM 1111/BA' },
  { id: 2, kind: 'piloto', name: 'Cap. Beltrano Teste', reg: 'CANAC 222222' },
]
// mesma fusão do setSlot do Crew.jsx: o patch por cima do que a posição já tinha
const digitar = (crew, k, kind, nome) => ({ ...crew, [k]: { ...(crew[k] || {}), ...slotPorNome(ROSTER, kind, nome) } })

let ok = 0
const t = (nome, fn) => { fn(); ok++; console.log('ok -', nome) }

t('nome do cadastro traz o registro', () => {
  const c = digitar({}, 'medico', 'medico', 'dra. fulana teste')
  assert.equal(c.medico.reg, 'CRM 1111/BA')
})

t('trocar por nome fora do cadastro não leva o registro de outra pessoa', () => {
  let c = digitar({}, 'medico', 'medico', 'Dra. Fulana Teste')
  c = digitar(c, 'medico', 'medico', 'Dr. Sicrano Avulso')
  assert.equal(c.medico.nome, 'Dr. Sicrano Avulso')
  assert.equal(c.medico.reg, '')
  // e não chega ao PDF / resumos
  const linhas = crewLinhas(c).map(([, v]) => v).join(' | ')
  assert.ok(!linhas.includes('CRM 1111'), linhas)
})

t('"Mesma equipe do caso anterior" e depois outro nome: registro copiado sai', () => {
  const anterior = { comandante: { nome: 'Cap. Antigo Avulso', reg: 'CANAC 999999' } }
  const c = digitar(anterior, 'comandante', 'piloto', 'Cap. Novo Avulso')
  assert.equal(c.comandante.reg, '')
})

t('trocar por outro nome do cadastro troca o registro', () => {
  let c = digitar({}, 'comandante', 'piloto', 'Cap. Beltrano Teste')
  assert.equal(c.comandante.reg, 'CANAC 222222')
  c = digitar(c, 'comandante', 'piloto', 'Dra. Fulana Teste') // existe, mas não é piloto
  assert.equal(c.comandante.reg, '')
})

t('campo esvaziado leva o registro', () => {
  let c = digitar({}, 'medico', 'medico', 'Dra. Fulana Teste')
  c = digitar(c, 'medico', 'medico', '')
  assert.deepEqual(c.medico, { nome: '', reg: '' })
})

console.log(`\n${ok} testes ok`)
