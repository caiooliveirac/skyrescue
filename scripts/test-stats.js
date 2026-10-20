// Teste do diagnóstico e das contas da tela Estatísticas (src/lib/stats.js).
// Sem banco, sem rede, dados fictícios:  node scripts/test-stats.js
import assert from 'node:assert/strict'
import { diagnose, aggregate, etapaMin, ETAPAS, municipio, quantil } from '../src/lib/stats.js'

const T0 = Date.UTC(2026, 9, 18, 13, 0, 0) // 10:00 em Salvador
const min = (m) => T0 + m * 60_000 + 1234   // fora do minuto cheio = tocado no app
const caso = (id, events, extra = {}) => ({ id, case_ref: `t-${id}`, created_at: new Date(T0).toISOString(), events, marcado_em: {}, criterios: [], ...extra })
const completo = (id, extra) => caso(id, {
  decisao: min(0), decolagem: min(8), pouso_cena: min(22), paciente: min(35),
  decolagem2: min(50), pouso_destino: min(62), entrega: min(75),
}, extra)

let ok = 0
const t = (nome, fn) => { fn(); ok++; console.log('ok -', nome) }

t('caso completo e coerente', () => {
  const d = diagnose(completo(1))
  assert.equal(d.nivel, 'ok')
  assert.equal(d.problemas.length, 0)
  assert.equal(d.aoVivo, 7)
  assert.equal(etapaMin(d, ETAPAS[1]), 14)
})

t('sem horários', () => {
  assert.equal(diagnose(caso(2, {})).nivel, 'vazio')
})

t('marcos tocados em sequência no fim ficam fora da conta', () => {
  const d = diagnose(caso(3, { decisao: min(0), decolagem: min(9), pouso_cena: min(120), paciente: min(120.2), decolagem2: min(120.4), pouso_destino: min(120.6), entrega: min(120.8) }))
  assert.equal(d.nivel, 'erro')
  assert.ok(d.suspeitos.has('entrega') && d.suspeitos.has('pouso_cena'))
  assert.equal(etapaMin(d, ETAPAS[0]), 9)          // acionamento → decolagem continua valendo
  assert.equal(etapaMin(d, ETAPAS[1]), null)       // decolagem → pouso (ponta suspeita)
})

t('um par colado só avisa', () => {
  const c = completo(4); c.events.decolagem2 = c.events.paciente + 20_000
  const d = diagnose(c)
  assert.equal(d.nivel, 'ok')
  assert.equal(d.problemas[0].nivel, 'aviso')
  assert.equal(etapaMin(d, ETAPAS[3]), null)
})

t('horário marcado dias depois', () => {
  const c = completo(5); c.events.entrega = min(60 * 24 * 40)
  const d = diagnose(c)
  assert.equal(d.nivel, 'erro')
  assert.match(d.problemas.map((p) => p.texto).join(' '), /40 dias depois/)
})

t('fora de ordem', () => {
  const c = completo(6); c.events.pouso_cena = min(5) // antes da decolagem
  const d = diagnose(c)
  assert.equal(d.nivel, 'erro')
  assert.match(d.problemas.map((p) => p.texto).join(' '), /Fora de ordem/)
})

t('faltam marcos = parcial', () => {
  const d = diagnose(caso(7, { decisao: min(0), decolagem: min(10), pouso_cena: min(25) }))
  assert.equal(d.nivel, 'parcial')
  assert.deepEqual(d.faltam, ['paciente', 'decolagem2', 'pouso_destino', 'entrega'])
})

t('registro: digitado e lançado depois', () => {
  const c = completo(8)
  c.events.decisao = T0                                // minuto cheio: digitado
  c.marcado_em = { entrega: c.events.entrega + 3600_000 } // gravado 1 h depois
  const d = diagnose(c)
  assert.equal(d.depois, 2)
  assert.equal(d.aoVivo, 5)
})

t('agregação: mediana, ganho e exclusão de ruins', () => {
  const casos = [
    completo(10, { ground_total_min: 120, air_total_min: 50, tag: 'AVC' }),
    completo(11, { ground_total_min: 100, air_total_min: 45, tag: 'AVC' }),
    caso(12, { decisao: min(0), decolagem: min(0.1), pouso_cena: min(0.2) }, { tag: 'Trauma' }),
  ]
  const a = aggregate(casos, { base: { lat: -12.78, lon: -38.4 } })
  assert.equal(a.n, 3)
  const total = a.totais.find((x) => x.id === 'total')
  assert.equal(total.n, 2)
  assert.equal(total.med, 75)
  assert.equal(a.ganho.med, 35)                      // (45 + 25) / 2
  assert.equal(a.diag.erro, 1)
  assert.equal(a.porTipo[0].label, 'AVC')
  assert.equal(a.porHora.find((h) => h.n).label, '10') // hora de Salvador
})

t('município pelo endereço quando falta scenePlace', () => {
  assert.equal(municipio({ scene_label: 'BA-522, Candeias, Bahia, Região Nordeste, Brasil' }), 'Candeias')
  assert.equal(municipio({ scene_label: 'Coordenadas informadas' }), 'Não informado')
  assert.equal(municipio({ cidade: 'Vera Cruz' }), 'Vera Cruz')
})

t('quantil', () => {
  assert.equal(quantil([1, 2, 3, 4], 0.5), 2.5)
  assert.equal(quantil([], 0.5), null)
})

console.log(`\n${ok} testes ok`)
