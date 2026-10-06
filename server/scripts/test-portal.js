// Handoff para o porteiro (server/src/portal.js), sem rede nem banco:
//   node server/scripts/test-portal.js
// O formato tem de bater com o lerHandoffGoa do porteiro (mnrs-portal, porteiro/lib.mjs).
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { criarHandoffPortal, destinoPortal, portalConfigurado, AUD_PORTEIRO, TIPO_HANDOFF } from '../src/portal.js'

const CHAVE = 'g'.repeat(40)
const T0 = 1_800_000_000
const user = { id: 42, username: 'ana.lima', full_name: 'Ana Lima', role: 'operador' }

const token = criarHandoffPortal(user, CHAVE, T0)
const [cab, pay, assinatura] = token.split('.')
assert.equal(assinatura, crypto.createHmac('sha256', CHAVE).update(`${cab}.${pay}`).digest('base64url'))
assert.deepEqual(JSON.parse(Buffer.from(cab, 'base64url')), { alg: 'HS256', typ: 'JWT' })
const c = JSON.parse(Buffer.from(pay, 'base64url'))
assert.equal(c.tipo, TIPO_HANDOFF)
assert.equal(c.origem, 'goa')
assert.equal(c.aud, AUD_PORTEIRO)
assert.equal(c.sub, '42')
assert.equal(c.login, 'ana.lima')
assert.equal(c.nome, 'Ana Lima')
assert.equal(c.exp - c.iat, 60)
assert.match(c.jti, /^[A-Za-z0-9_-]{16,64}$/)
assert.notEqual(criarHandoffPortal(user, CHAVE, T0), token, 'jti novo a cada handoff')
assert.equal('nome' in JSON.parse(Buffer.from(criarHandoffPortal({ ...user, full_name: null }, CHAVE, T0).split('.')[1], 'base64url')), false)

assert.equal(portalConfigurado({}), false)
assert.equal(portalConfigurado({ GOA_FEDERACAO_SECRET: 'curta' }), false)
assert.equal(portalConfigurado({ GOA_FEDERACAO_SECRET: CHAVE }), true)

const env = { GOA_FEDERACAO_SECRET: CHAVE, PORTAL_URL: 'https://mnrs.com.br/' }
assert.match(destinoPortal(user, 'tabela', env), /^https:\/\/mnrs\.com\.br\/_auth\/de\/goa\?token=[^&]+&proximo=tabela$/)
// a Mesa do plantões não é do interno: o pedido cai no portal, sem proximo
assert.match(destinoPortal(user, 'plantoes', env), /^https:\/\/mnrs\.com\.br\/_auth\/de\/goa\?token=[^&]+$/)
assert.match(destinoPortal(user, 'https://mal.example', env), /^https:\/\/mnrs\.com\.br\/_auth\/de\/goa\?token=[^&]+$/)
console.log('ok — handoff do portal')
