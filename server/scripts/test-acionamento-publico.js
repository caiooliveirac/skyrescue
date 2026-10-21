// SOUT-26: a rota pública POST /api/acionamentos (a) não pode deixar lixo gastar
// o teto global — 40 POSTs inválidos travavam o acionamento por 1 h — e (b) o
// limite por IP não pode ser burlado trocando o primeiro X-Forwarded-For.
// Puro (sem banco, sem rede): roda a mesma cadeia de middlewares da rota.
//   node server/scripts/test-acionamento-publico.js
import { clientIp, cadeiaAcionamento, criarLimite, RL_IP_MAX, RL_GLOBAL_MAX } from '../src/acionamento-publico.js'

let falhas = 0
const ok = (nome, cond, detalhe = '') => {
  console.log(`${cond ? '  OK  ' : ' FALHA'} ${nome}${detalhe ? ` — ${detalhe}` : ''}`)
  if (!cond) falhas++
}

const CF_EDGE = '172.68.19.188'   // borda Cloudflare, como aparece no access.log do nginx
// requisição como o nginx do goa entrega: X-Real-IP = $remote_addr (salto)
const req = ({ body = {}, realIp = CF_EDGE, cfIp, xff } = {}) => ({
  body,
  headers: { 'x-real-ip': realIp, ...(cfIp && { 'cf-connecting-ip': cfIp }), ...(xff && { 'x-forwarded-for': xff }) },
  socket: { remoteAddress: '127.0.0.1' },
})
function rodar(cadeia, r) {
  let status = 200, passou = false
  const res = { status(c) { status = c; return this }, json() { return this } }
  const step = (i) => { if (i === cadeia.length) { passou = true; return } cadeia[i](r, res, () => step(i + 1)) }
  step(0)
  return { status, passou }
}
const valido = { local: 'Av. Paralela, 1000' }

console.log('=== IP do cliente ===')
ok('via Cloudflare: vale o CF-Connecting-IP', clientIp(req({ cfIp: '200.1.2.3', xff: '9.9.9.9, 200.1.2.3' })) === '200.1.2.3')
ok('primeiro X-Forwarded-For forjado não vira o IP', clientIp(req({ cfIp: '200.1.2.3', xff: '1.1.1.1, 200.1.2.3' })) !== '1.1.1.1')
ok('direto na origem: CF-Connecting-IP forjado é ignorado', clientIp(req({ realIp: '45.6.7.8', cfIp: '1.1.1.1', xff: '1.1.1.1' })) === '45.6.7.8')
ok('IPv6 da Cloudflare também é reconhecido', clientIp(req({ realIp: '2606:4700::1', cfIp: '2804:14c::1' })) === '2804:14c::1')
ok('sem nginx (local): IP do socket', clientIp({ headers: {}, socket: { remoteAddress: '::ffff:127.0.0.1' } }) === '127.0.0.1')

console.log('\n=== lixo não gasta o teto global ===')
{
  const cadeia = cadeiaAcionamento(criarLimite())
  let todos400 = true
  for (let i = 0; i < RL_GLOBAL_MAX + 10; i++) {
    const r = rodar(cadeia, req({ body: { lixo: i }, cfIp: `10.0.${i >> 8}.${i & 255}` }))
    if (r.status !== 400) todos400 = false
  }
  ok(`${RL_GLOBAL_MAX + 10} POSTs inválidos levam 400`, todos400)
  const r = rodar(cadeia, req({ body: valido, cfIp: '200.9.9.9' }))
  ok('depois deles, um pedido válido passa', r.passou, `status=${r.status}`)
}

console.log('\n=== limite por IP não se burla pelo X-Forwarded-For ===')
{
  const cadeia = cadeiaAcionamento(criarLimite())
  let passaram = 0
  for (let i = 0; i < RL_IP_MAX + 3; i++) {
    if (rodar(cadeia, req({ body: valido, cfIp: '200.7.7.7', xff: `5.5.5.${i}, 200.7.7.7` })).passou) passaram++
  }
  ok(`mesmo IP real com XFF trocado: só ${RL_IP_MAX} passam`, passaram === RL_IP_MAX, `passaram=${passaram}`)
  ok('outro IP real continua passando', rodar(cadeia, req({ body: valido, cfIp: '200.8.8.8' })).passou)
}

console.log('\n=== o teto global ainda vale para pedido válido ===')
{
  const cadeia = cadeiaAcionamento(criarLimite())
  let passaram = 0
  for (let i = 0; i < RL_GLOBAL_MAX + 5; i++) {
    if (rodar(cadeia, req({ body: valido, cfIp: `201.0.${i >> 8}.${i & 255}` })).passou) passaram++
  }
  ok(`${RL_GLOBAL_MAX + 5} válidos de IPs distintos: ${RL_GLOBAL_MAX} passam`, passaram === RL_GLOBAL_MAX, `passaram=${passaram}`)
}

console.log(`\n${falhas === 0 ? 'TODOS OS TESTES PASSARAM' : `${falhas} TESTE(S) FALHARAM`}`)
process.exit(falhas === 0 ? 0 : 1)
