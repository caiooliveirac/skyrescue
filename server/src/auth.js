import crypto from 'node:crypto'
import { query } from './db.js'

// ---------- hash de senha (scrypt nativo, sem dependência) ----------
const SCRYPT_N = 16384, SCRYPT_r = 8, SCRYPT_p = 1, KEYLEN = 32

export function hashPassword(password) {
  const salt = crypto.randomBytes(16)
  const hash = crypto.scryptSync(password, salt, KEYLEN, { N: SCRYPT_N, r: SCRYPT_r, p: SCRYPT_p })
  return `${SCRYPT_N}:${SCRYPT_r}:${SCRYPT_p}:${salt.toString('hex')}:${hash.toString('hex')}`
}

export function verifyPassword(password, stored) {
  try {
    const [N, r, p, saltHex, hashHex] = stored.split(':')
    const salt = Buffer.from(saltHex, 'hex')
    const expected = Buffer.from(hashHex, 'hex')
    const actual = crypto.scryptSync(password, salt, expected.length, { N: +N, r: +r, p: +p })
    return crypto.timingSafeEqual(actual, expected)
  } catch (e) {
    return false
  }
}

// ---------- sessões ----------
const SESSION_TTL_HOURS = Number(process.env.SESSION_TTL_HOURS || 12)
export const COOKIE_NAME = 'sky_sess'

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex')

export async function createSession(userId, { userAgent, ip } = {}) {
  const token = crypto.randomBytes(32).toString('hex')
  const expires = new Date(Date.now() + SESSION_TTL_HOURS * 3600_000)
  await query(
    `INSERT INTO sessions (token_hash, user_id, expires_at, user_agent, ip)
     VALUES ($1, $2, $3, $4, $5)`,
    [sha256(token), userId, expires, (userAgent || '').slice(0, 300), ip || null]
  )
  return { token, expires }
}

export async function destroySession(token) {
  if (!token) return
  await query('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)])
}

export function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_HOURS * 3600_000,
  }
}

// middleware: popula req.user a partir do cookie de sessão; expira sessões vencidas
export async function authMiddleware(req, _res, next) {
  const token = req.cookies?.[COOKIE_NAME]
  if (!token) return next()
  try {
    const { rows } = await query(
      `SELECT u.id, u.username, u.full_name, u.role, u.active, s.expires_at
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = $1`,
      [sha256(token)]
    )
    const s = rows[0]
    if (s && s.active && new Date(s.expires_at) > new Date()) {
      req.user = { id: s.id, username: s.username, full_name: s.full_name, role: s.role }
    } else if (s) {
      await destroySession(token) // vencida ou usuário inativo
    }
  } catch (e) {
    console.error('authMiddleware:', e.message)
  }
  next()
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'não autenticado' })
  next()
}

export function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'não autenticado' })
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'requer perfil admin' })
  next()
}

// limpeza periódica de sessões vencidas
export function startSessionGC() {
  const run = () => query('DELETE FROM sessions WHERE expires_at < now()').catch(() => {})
  run()
  setInterval(run, 3600_000).unref()
}
