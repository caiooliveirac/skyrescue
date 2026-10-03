import crypto from 'node:crypto'

// ---------- passagem para o portal mnrs.com.br (internos de medicina) ----------
// O interno logado aqui abre a Mesa operacional do plantões e o Painel
// (Tabela, Quadro) sem segunda senha: este servidor assina um handoff de 60 s
// e o navegador leva até o porteiro do portal (mnrs.com.br/_auth/de/goa). O
// porteiro confere a assinatura e pergunta ao plantões QUAL conta de lá é este
// usuário — lá ela é sempre só `interno` (lê a Mesa, não escreve). Contrato e
// regras no plantões: docs/internos-goa.md.
//
// Só sai handoff para usuário marcado com `acesso_portal` (admin marca:
// PATCH /api/users/:id ou scripts/acesso-portal.js). Chave GOA_FEDERACAO_SECRET,
// a mesma no ambiente do porteiro e só lá. FALHA FECHADA: sem ela (ou curta) a
// rota responde 404 e o botão nem aparece.

export const AUD_PORTEIRO = 'mnrs-porteiro'
export const TIPO_HANDOFF = 'goa-handoff'
const VALIDADE_S = 60

// sistemas que o interno alcança no portal (porteiro lib.mjs, internoDoGoa)
export const PROXIMOS = new Set(['plantoes', 'tabela', 'destino', 'giro', 'quadro'])

export function portalConfigurado(env = process.env) {
  return (env.GOA_FEDERACAO_SECRET || '').trim().length >= 32
}

export function portalUrl(env = process.env) {
  return (env.PORTAL_URL || 'https://mnrs.com.br').trim().replace(/\/+$/, '')
}

const b64 = (v) => Buffer.from(v).toString('base64url')

/** JWT HS256 no formato que o porteiro lê (lerHandoffGoa). `agora` em segundos. */
export function criarHandoffPortal(user, chave, agora = Math.floor(Date.now() / 1000)) {
  const corpo = {
    tipo: TIPO_HANDOFF,
    origem: 'goa',
    sub: String(user.id),
    login: user.username,
    aud: AUD_PORTEIRO,
    iat: agora,
    exp: agora + VALIDADE_S,
    jti: crypto.randomBytes(18).toString('base64url'),
  }
  if (user.full_name) corpo.nome = String(user.full_name).slice(0, 160)
  const cab = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const pay = b64(JSON.stringify(corpo))
  const assinatura = crypto.createHmac('sha256', chave).update(`${cab}.${pay}`).digest('base64url')
  return `${cab}.${pay}.${assinatura}`
}

/** Para onde mandar o navegador: porteiro com o token e o sistema pedido. */
export function destinoPortal(user, proximo, env = process.env) {
  const token = criarHandoffPortal(user, env.GOA_FEDERACAO_SECRET.trim())
  const p = PROXIMOS.has(proximo) ? `&proximo=${encodeURIComponent(proximo)}` : ''
  return `${portalUrl(env)}/_auth/de/goa?token=${encodeURIComponent(token)}${p}`
}
