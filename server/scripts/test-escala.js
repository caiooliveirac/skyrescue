// Escala dos internos (/api/escala) e leitura dos contatos SAMU: quem vê, quem edita e as regras de
// alocação. Roda contra a API de desenvolvimento ligada no MESMO banco de
// dev/teste (a trava recusa outro banco):
//   BASE=http://127.0.0.1:3012 DATABASE_URL=postgres://localhost/skyrescue_dev node scripts/test-escala.js
// Usa usuários próprios (prefixo t-escala-) e datas em 2099; apaga os
// plantões deles no começo e no fim.
import { query, pool } from '../src/db.js'
import { hashPassword } from '../src/auth.js'
import { exigirBancoDeTeste } from './banco-de-teste.js'

const BASE = process.env.BASE || 'http://127.0.0.1:3012'
const SENHA = 'senha-de-teste-da-escala'

let falhas = 0
const ok = (nome, cond, detalhe = '') => {
  console.log(`${cond ? '  OK  ' : ' FALHA'} ${nome}${detalhe ? ` — ${detalhe}` : ''}`)
  if (!cond) falhas++
}

async function usuario(username, role, interno) {
  const { rows } = await query(
    `INSERT INTO users (username, password_hash, full_name, role, acesso_portal)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (username) DO UPDATE
       SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role,
           acesso_portal = EXCLUDED.acesso_portal, active = TRUE
     RETURNING id`,
    [username, hashPassword(SENHA), `Teste ${username}`, role, interno]
  )
  return rows[0].id
}

// sessão HTTP de um usuário: devolve (método, rota, corpo) → {status, body}
async function sessao(username) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: SENHA }),
  })
  if (!r.ok) throw new Error(`login ${username}: HTTP ${r.status}`)
  const cookie = r.headers.get('set-cookie').split(';')[0]
  return async (method, path, body) => {
    const res = await fetch(`${BASE}/api${path}`, {
      method,
      headers: { cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
    return { status: res.status, body: await res.json().catch(() => null) }
  }
}

async function main() {
  await exigirBancoDeTeste()
  const ids = {
    admin: await usuario('t-escala-admin', 'admin', false),
    gestor: await usuario('t-escala-gestor', 'gestor', false),
    reg: await usuario('t-escala-reg', 'regulador', false),
    int1: await usuario('t-escala-int1', 'operador', true),
    int2: await usuario('t-escala-int2', 'regulador', true),
    inativo: await usuario('t-escala-inativo', 'operador', true),
  }
  await query('UPDATE users SET active = FALSE WHERE id = $1', [ids.inativo])
  const limpar = async () => {
    await query('DELETE FROM escala_interno WHERE user_id = ANY($1)', [Object.values(ids)])
    await query(`DELETE FROM escala_log WHERE dia >= '2099-01-01'`)
  }
  await limpar()

  const admin = await sessao('t-escala-admin')
  const gestor = await sessao('t-escala-gestor')
  const reg = await sessao('t-escala-reg')
  const int1 = await sessao('t-escala-int1')
  const SEM = '?de=2099-01-05&ate=2099-01-11'

  console.log('=== quem vê ===')
  ok('interno: /auth/me marca interno', (await int1('GET', '/auth/me')).body?.user?.interno === true)
  ok('regulador sem a marca: /auth/me não marca', (await reg('GET', '/auth/me')).body?.user?.interno === false)
  ok('interno lê a escala', (await int1('GET', `/escala${SEM}`)).status === 200)
  ok('gestor lê a escala', (await gestor('GET', `/escala${SEM}`)).status === 200)
  ok('regulador sem a marca não lê (403)', (await reg('GET', `/escala${SEM}`)).status === 403)
  const ga = await admin('GET', `/escala${SEM}`)
  ok('admin lê e recebe a lista de internos ativos',
    ga.status === 200 && ga.body.internos.some((i) => i.id === ids.int1) && !ga.body.internos.some((i) => i.id === ids.inativo))
  ok('interno recebe a lista para alocar', (await int1('GET', `/escala${SEM}`)).body.internos.some((i) => i.id === ids.int2))
  ok('gestor não recebe a lista para alocar', (await gestor('GET', `/escala${SEM}`)).body.internos.length === 0)

  console.log('=== quem edita ===')
  const novo = { dia: '2099-01-05', turno: 'manha', user_id: ids.int1 }
  ok('gestor não escala (403)', (await gestor('POST', '/escala', novo)).status === 403)
  ok('regulador sem a marca não escala (403)', (await reg('POST', '/escala', novo)).status === 403)
  const pi = await int1('POST', '/escala', { ...novo, dia: '2099-01-06', user_id: ids.int2 })
  ok('interno escala colega (201)', pi.status === 201, JSON.stringify(pi.body))
  ok('interno tira da escala (200)', (await int1('DELETE', `/escala/${pi.body?.plantao?.id}`)).status === 200)
  const p1 = await admin('POST', '/escala', novo)
  ok('admin escala (201)', p1.status === 201 && p1.body.plantao.dia === '2099-01-05', JSON.stringify(p1.body))
  ok('gestor não tira da escala (403)', (await gestor('DELETE', `/escala/${p1.body.plantao.id}`)).status === 403)

  console.log('=== contatos SAMU ===')
  ok('interno lê os contatos', (await int1('GET', '/samu-contacts')).status === 200)
  ok('regulador sem a marca não lê os contatos (403)', (await reg('GET', '/samu-contacts')).status === 403)
  const ci = await int1('POST', '/samu-contacts', { samu: 't-escala SAMU teste', phone: '0' })
  ok('interno cadastra contato (201)', ci.status === 201, JSON.stringify(ci.body))
  ok('regulador sem a marca não cadastra (403)', (await reg('POST', '/samu-contacts', { samu: 'x', phone: '0' })).status === 403)
  ok('interno não edita contato (403)', (await int1('PUT', `/samu-contacts/${ci.body?.contact?.id}`, { samu: 'x', phone: '1' })).status === 403)
  ok('interno não exclui contato (403)', (await int1('DELETE', `/samu-contacts/${ci.body?.contact?.id}`)).status === 403)
  ok('admin exclui o contato de teste (200)', (await admin('DELETE', `/samu-contacts/${ci.body?.contact?.id}`)).status === 200)

  console.log('=== regras de alocação ===')
  ok('mesmo turno de novo (409)', (await admin('POST', '/escala', novo)).status === 409)
  ok('diurno no dia em que já tem manhã (409)', (await admin('POST', '/escala', { ...novo, turno: 'diurno' })).status === 409)
  ok('manhã + tarde no mesmo dia (201)', (await admin('POST', '/escala', { ...novo, turno: 'tarde' })).status === 201)
  ok('dois internos no mesmo turno (201)', (await admin('POST', '/escala', { ...novo, user_id: ids.int2 })).status === 201)
  ok('usuário que não é interno (400)', (await admin('POST', '/escala', { ...novo, user_id: ids.reg })).status === 400)
  ok('interno inativo (400)', (await admin('POST', '/escala', { ...novo, user_id: ids.inativo })).status === 400)
  ok('turno inexistente (400)', (await admin('POST', '/escala', { ...novo, turno: 'noite' })).status === 400)
  ok('dia que não existe, 31/02 (400)', (await admin('POST', '/escala', { ...novo, dia: '2099-02-31' })).status === 400)
  ok('mês 13 (400, sem derrubar a API)', (await admin('POST', '/escala', { ...novo, dia: '2099-13-01' })).status === 400)
  ok('período invertido (400)', (await admin('GET', '/escala?de=2099-01-11&ate=2099-01-05')).status === 400)
  ok('período acima de 62 dias (400)', (await admin('GET', '/escala?de=2099-01-01&ate=2099-06-01')).status === 400)

  console.log('=== o que o interno vê ===')
  const gi = await int1('GET', `/escala${SEM}`)
  const meus = gi.body.plantoes.filter((p) => p.user_id === ids.int1)
  ok('vê os próprios plantões da semana', meus.length === 2 && meus.every((p) => p.dia === '2099-01-05'))
  ok('vê os colegas escalados', gi.body.plantoes.some((p) => p.user_id === ids.int2 && p.nome))
  ok('próximos plantões trazem os dele', gi.body.proximos.length === 2)

  console.log('=== troca e trilha ===')
  const pt = await admin('POST', '/escala', { dia: '2099-01-07', turno: 'diurno', user_id: ids.int1 })
  ok('troca sem login de editor: gestor (403)', (await gestor('PUT', `/escala/${pt.body.plantao.id}`, { user_id: ids.int2 })).status === 403)
  ok('troca pela mesma pessoa (400)', (await int1('PUT', `/escala/${pt.body.plantao.id}`, { user_id: ids.int1 })).status === 400)
  ok('troca por quem não é interno (400)', (await int1('PUT', `/escala/${pt.body.plantao.id}`, { user_id: ids.reg })).status === 400)
  const tr = await int1('PUT', `/escala/${pt.body.plantao.id}`, { user_id: ids.int2 })
  ok('interno troca (200), mesmo plantão com outra pessoa', tr.status === 200 && tr.body.plantao.user_id == ids.int2 && tr.body.plantao.id == pt.body.plantao.id, JSON.stringify(tr.body))
  ok('troca por quem já está no dia (409)', (await int1('PUT', `/escala/${p1.body.plantao.id}`, { user_id: ids.int2 })).status === 409)
  ok('troca de plantão inexistente (404)', (await int1('PUT', '/escala/999999999', { user_id: ids.int2 })).status === 404)
  const hist = (await gestor('GET', `/escala${SEM}`)).body.historico || []
  const troca = hist.find((h) => h.acao === 'trocou' && h.dia === '2099-01-07')
  ok('trilha: troca com ator, quem saiu e quem entrou',
    troca && troca.ator_login === 't-escala-int1' && troca.sai_id == ids.int1 && troca.entra_id == ids.int2 && troca.sai_nome && troca.entra_nome,
    JSON.stringify(troca))
  ok('trilha: o escalar do admin aparece', hist.some((h) => h.acao === 'escalou' && h.ator_login === 't-escala-admin' && h.entra_id == ids.int1))
  ok('trilha: o tirar do interno aparece', hist.some((h) => h.acao === 'tirou' && h.ator_login === 't-escala-int1' && h.sai_id == ids.int2))
  ok('trilha visível para o interno', ((await int1('GET', `/escala${SEM}`)).body.historico || []).length === hist.length)
  ok('trilha restrita: regulador sem a marca não vê (403)', (await reg('GET', `/escala${SEM}`)).status === 403)

  console.log('=== tirar da escala ===')
  ok('admin tira (200)', (await admin('DELETE', `/escala/${p1.body.plantao.id}`)).status === 200)
  const depois = await int1('GET', `/escala${SEM}`)
  ok('some da escala', !depois.body.plantoes.some((p) => p.id === p1.body.plantao.id))
  ok('API segue de pé', (await fetch(`${BASE}/api/health`)).ok)

  await limpar()
  // não deixa os usuários de teste na lista de internos da tela de dev
  await query('UPDATE users SET active = FALSE WHERE id = ANY($1)', [Object.values(ids)])
  console.log(falhas ? `\n${falhas} FALHA(S)` : '\ntudo ok')
  await pool.end()
  process.exit(falhas ? 1 : 0)
}

main().catch(async (e) => { console.error(e); await pool.end(); process.exit(1) })
