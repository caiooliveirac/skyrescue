// Teste ponta a ponta do rastreamento da aeronave, pela API de verdade
// (não é socket: o tablet POSTa a posição e a regulação faz GET a cada 10 s;
// o marcador some na tela com dado > 90 s). Precisa da API no ar:
//   API_URL=http://127.0.0.1:3014 USUARIO=goa.samu SENHA=... node scripts/test-rastreamento.js
const API = process.env.API_URL || 'http://127.0.0.1:3012'
const USUARIO = process.env.USUARIO || 'goa.samu'
const SENHA = process.env.SENHA || 'samu@192' // seed de dev do README

let falhas = 0
const ok = (nome, cond, detalhe = '') => {
  console.log(`${cond ? '  OK  ' : ' FALHA'} ${nome}${detalhe ? ` — ${detalhe}` : ''}`)
  if (!cond) falhas++
}
let cookie = ''
async function req(method, path, body, auth = true) {
  const r = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(auth && cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const set = r.headers.get('set-cookie')
  if (set) cookie = set.split(';')[0]
  let data = null
  try { data = await r.json() } catch (e) { /* sem corpo */ }
  return { status: r.status, data }
}

async function main() {
  const h = await req('GET', '/api/health', null, false)
  if (h.status !== 200) { console.error(`API não responde em ${API} (${h.status})`); process.exit(2) }

  console.log('=== sem sessão ===')
  const anon = await req('POST', '/api/aircraft/position', { lat: -12.9, lon: -38.4 }, false)
  ok('POST posição sem login é recusado', anon.status === 401, `status=${anon.status}`)

  const login = await req('POST', '/api/auth/login', { username: USUARIO, password: SENHA })
  if (login.status !== 200) { console.error('login falhou:', login.status, login.data); process.exit(2) }

  console.log('\n=== piloto reporta, regulação lê ===')
  const p1 = { lat: -12.7667, lon: -38.3833, gsKmh: 210, track: 135, accM: 8 }
  const r1 = await req('POST', '/api/aircraft/position', p1)
  ok('POST posição 1 aceito', r1.status === 200, `status=${r1.status}`)
  const g1 = await req('GET', '/api/aircraft/position')
  const pos1 = g1.data?.position
  ok('GET devolve a posição', !!pos1, JSON.stringify(g1.data).slice(0, 80))
  ok('coordenadas batem', pos1 && Math.abs(pos1.lat - p1.lat) < 1e-6 && Math.abs(pos1.lon - p1.lon) < 1e-6)
  ok('velocidade e rumo batem', pos1 && Number(pos1.gs_kmh) === 210 && Number(pos1.track) === 135)
  const idade1 = Date.now() - new Date(pos1?.reported_at).getTime()
  ok('reported_at é de agora (< 5 s)', Number.isFinite(idade1) && idade1 >= 0 && idade1 < 5000, `${idade1} ms`)
  ok('a regulação ainda mostraria o marcador (< 90 s)', idade1 < 90_000)
  ok('quem reporta aparece', pos1?.reported_by_username === USUARIO, `${pos1?.reported_by_username}`)

  console.log('\n=== segunda posição substitui a primeira (uma aeronave, uma linha) ===')
  const p2 = { lat: -12.8, lon: -38.45, gsKmh: 205, track: 140 }
  const r2 = await req('POST', '/api/aircraft/position', p2)
  ok('POST posição 2 aceito', r2.status === 200)
  const g2 = await req('GET', '/api/aircraft/position')
  const pos2 = g2.data?.position
  ok('GET devolve a posição nova', pos2 && Math.abs(pos2.lat - p2.lat) < 1e-6 && Math.abs(pos2.lon - p2.lon) < 1e-6)
  ok('reported_at avançou', new Date(pos2?.reported_at) >= new Date(pos1?.reported_at))

  console.log('\n=== entrada inválida ===')
  const bad = await req('POST', '/api/aircraft/position', { lat: 'x', lon: -38 })
  ok('coordenada inválida é 400', bad.status === 400, `status=${bad.status}`)
  const g3 = await req('GET', '/api/aircraft/position')
  ok('e não sujou a posição', g3.data?.position && Math.abs(g3.data.position.lat - p2.lat) < 1e-6)

  console.log(`\n${falhas ? `${falhas} FALHA(S)` : 'tudo OK'}`)
  process.exit(falhas ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(2) })
