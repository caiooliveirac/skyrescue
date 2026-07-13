import express from 'express'
import cookieParser from 'cookie-parser'
import { query, pool } from './db.js'
import {
  hashPassword, verifyPassword, createSession, destroySession,
  cookieOptions, authMiddleware, requireAuth, requireAdmin,
  COOKIE_NAME, startSessionGC,
} from './auth.js'

const app = express()
app.set('trust proxy', 1) // atrás do nginx/Cloudflare
app.use(express.json({ limit: '1mb' }))
app.use(cookieParser())
app.use(authMiddleware)

const clientIp = (req) => (req.headers['x-forwarded-for']?.split(',')[0]?.trim()) || req.ip
const publicUser = (u) => ({ id: u.id, username: u.username, full_name: u.full_name, role: u.role })

// ---------- health ----------
app.get('/api/health', async (_req, res) => {
  try { await query('SELECT 1'); res.json({ ok: true }) }
  catch (e) { res.status(503).json({ ok: false, error: e.message }) }
})

// ---------- auth ----------
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body || {}
  if (!username || !password) return res.status(400).json({ error: 'usuário e senha obrigatórios' })
  try {
    const { rows } = await query(
      'SELECT id, username, full_name, role, active, password_hash FROM users WHERE lower(username) = lower($1)',
      [String(username).trim()]
    )
    const u = rows[0]
    // verifica a senha mesmo sem usuário (mitiga enumeração por timing)
    const ok = u && u.active && verifyPassword(password, u.password_hash)
    if (!ok) return res.status(401).json({ error: 'usuário ou senha incorretos' })

    const { token } = await createSession(u.id, { userAgent: req.headers['user-agent'], ip: clientIp(req) })
    await query('UPDATE users SET last_login_at = now() WHERE id = $1', [u.id])
    res.cookie(COOKIE_NAME, token, cookieOptions())
    res.json({ user: publicUser(u) })
  } catch (e) {
    console.error('login:', e)
    res.status(500).json({ error: 'erro interno' })
  }
})

app.post('/api/auth/logout', async (req, res) => {
  await destroySession(req.cookies?.[COOKIE_NAME])
  res.clearCookie(COOKIE_NAME, { ...cookieOptions(), maxAge: undefined })
  res.json({ ok: true })
})

app.get('/api/auth/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }))

// troca da própria senha
app.post('/api/auth/password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {}
  if (!newPassword || String(newPassword).length < 6)
    return res.status(400).json({ error: 'nova senha deve ter ao menos 6 caracteres' })
  const { rows } = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id])
  if (!rows[0] || !verifyPassword(currentPassword || '', rows[0].password_hash))
    return res.status(401).json({ error: 'senha atual incorreta' })
  await query('UPDATE users SET password_hash = $1 WHERE id = $2', [hashPassword(newPassword), req.user.id])
  res.json({ ok: true })
})

// ---------- casos ----------
// registro compartilhado: todos os autenticados veem todos os casos, com autoria.
const promote = (snapshot = {}) => ({
  case_ref: snapshot.id || null,
  scene_label: snapshot.sceneLabel || null,
  scene_lat: snapshot.scene?.lat ?? null,
  scene_lon: snapshot.scene?.lon ?? null,
  score_total: snapshot.scoreTotal ?? null,
  score_band: snapshot.band || null,
  recommendation: snapshot.recommendation || null,
  hospital_name: snapshot.hospitalName || null,
  air_total_min: snapshot.mission?.airTotal ?? null,
  ground_total_min: snapshot.mission?.groundTotal ?? null,
  delta_min: snapshot.mission?.delta ?? null,
  gates_ok: snapshot.gatesOk ?? null,
  notes: snapshot.notes || null,
})

app.get('/api/cases', requireAuth, async (_req, res) => {
  const { rows } = await query(
    `SELECT c.id, c.case_ref, c.scene_label, c.scene_lat, c.scene_lon,
            c.score_total, c.score_band, c.recommendation, c.hospital_name,
            c.air_total_min, c.ground_total_min, c.delta_min, c.gates_ok,
            c.created_at, c.updated_at,
            cu.username AS created_by_username, cu.full_name AS created_by_name
       FROM cases c
       LEFT JOIN users cu ON cu.id = c.created_by
      ORDER BY c.updated_at DESC
      LIMIT 500`
  )
  res.json({ cases: rows })
})

app.get('/api/cases/:id', requireAuth, async (req, res) => {
  const { rows } = await query('SELECT * FROM cases WHERE id = $1', [req.params.id])
  if (!rows[0]) return res.status(404).json({ error: 'caso não encontrado' })
  res.json({ case: rows[0] })
})

app.post('/api/cases', requireAuth, async (req, res) => {
  const snapshot = req.body?.snapshot
  if (!snapshot || typeof snapshot !== 'object')
    return res.status(400).json({ error: 'snapshot obrigatório' })
  const p = promote(snapshot)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
      `INSERT INTO cases
         (case_ref, created_by, updated_by, scene_label, scene_lat, scene_lon,
          score_total, score_band, recommendation, hospital_name,
          air_total_min, ground_total_min, delta_min, gates_ok, notes, snapshot)
       VALUES ($1,$2,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING id, created_at`,
      [p.case_ref, req.user.id, p.scene_label, p.scene_lat, p.scene_lon,
       p.score_total, p.score_band, p.recommendation, p.hospital_name,
       p.air_total_min, p.ground_total_min, p.delta_min, p.gates_ok, p.notes, snapshot]
    )
    await client.query(
      'INSERT INTO case_audit (case_id, user_id, action, case_ref) VALUES ($1,$2,$3,$4)',
      [rows[0].id, req.user.id, 'create', p.case_ref]
    )
    await client.query('COMMIT')
    res.status(201).json({ id: rows[0].id, created_at: rows[0].created_at })
  } catch (e) {
    await client.query('ROLLBACK')
    console.error('create case:', e)
    res.status(500).json({ error: 'erro ao salvar caso' })
  } finally {
    client.release()
  }
})

app.put('/api/cases/:id', requireAuth, async (req, res) => {
  const snapshot = req.body?.snapshot
  if (!snapshot || typeof snapshot !== 'object')
    return res.status(400).json({ error: 'snapshot obrigatório' })
  const p = promote(snapshot)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
      `UPDATE cases SET
         case_ref=$2, updated_by=$3, updated_at=now(), scene_label=$4, scene_lat=$5, scene_lon=$6,
         score_total=$7, score_band=$8, recommendation=$9, hospital_name=$10,
         air_total_min=$11, ground_total_min=$12, delta_min=$13, gates_ok=$14, notes=$15, snapshot=$16
       WHERE id=$1 RETURNING id, updated_at`,
      [req.params.id, p.case_ref, req.user.id, p.scene_label, p.scene_lat, p.scene_lon,
       p.score_total, p.score_band, p.recommendation, p.hospital_name,
       p.air_total_min, p.ground_total_min, p.delta_min, p.gates_ok, p.notes, snapshot]
    )
    if (!rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'caso não encontrado' }) }
    await client.query(
      'INSERT INTO case_audit (case_id, user_id, action, case_ref) VALUES ($1,$2,$3,$4)',
      [req.params.id, req.user.id, 'update', p.case_ref]
    )
    await client.query('COMMIT')
    res.json({ id: rows[0].id, updated_at: rows[0].updated_at })
  } catch (e) {
    await client.query('ROLLBACK')
    console.error('update case:', e)
    res.status(500).json({ error: 'erro ao atualizar caso' })
  } finally {
    client.release()
  }
})

app.delete('/api/cases/:id', requireAuth, async (req, res) => {
  const { rows } = await query('SELECT case_ref FROM cases WHERE id = $1', [req.params.id])
  if (!rows[0]) return res.status(404).json({ error: 'caso não encontrado' })
  await query('DELETE FROM cases WHERE id = $1', [req.params.id])
  await query(
    'INSERT INTO case_audit (case_id, user_id, action, case_ref) VALUES ($1,$2,$3,$4)',
    [req.params.id, req.user.id, 'delete', rows[0].case_ref]
  )
  res.json({ ok: true })
})

// ---------- pontos de pouso da comunidade ----------
// qualquer usuário logado sugere; admin valida ('aprovado') ou rejeita.
// rejeitados só aparecem para o admin e para o próprio autor.
app.get('/api/community-lz', requireAuth, async (req, res) => {
  const { rows } = await query(
    `SELECT z.id, z.name, z.description, z.municipio, z.lat, z.lon, z.status,
            z.created_at, z.created_by, z.reviewed_at, z.review_note,
            cu.username AS created_by_username, cu.full_name AS created_by_name,
            ru.username AS reviewed_by_username, ru.full_name AS reviewed_by_name
       FROM community_lz z
       LEFT JOIN users cu ON cu.id = z.created_by
       LEFT JOIN users ru ON ru.id = z.reviewed_by
      WHERE z.status <> 'rejeitado' OR z.created_by = $1 OR $2
      ORDER BY (z.status = 'pendente') DESC, z.created_at DESC`,
    [req.user.id, req.user.role === 'admin']
  )
  res.json({ points: rows })
})

app.post('/api/community-lz', requireAuth, async (req, res) => {
  const { name, lat, lon, municipio, description } = req.body || {}
  const la = Number(lat), lo = Number(lon)
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'nome do local é obrigatório' })
  if (!Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180)
    return res.status(400).json({ error: 'coordenadas inválidas' })
  try {
    const { rows } = await query(
      `INSERT INTO community_lz (name, description, municipio, lat, lon, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, created_at`,
      [String(name).trim().slice(0, 120), description ? String(description).slice(0, 500) : null,
       municipio ? String(municipio).trim().slice(0, 80) : null, la, lo, req.user.id]
    )
    res.status(201).json({ id: rows[0].id, created_at: rows[0].created_at })
  } catch (e) {
    console.error('create community-lz:', e)
    res.status(500).json({ error: 'erro ao registrar sugestão' })
  }
})

// validação/rejeição e ajuste fino (nome/coordenadas) — só admin
app.patch('/api/community-lz/:id', requireAdmin, async (req, res) => {
  const { status, review_note, name, description, municipio, lat, lon } = req.body || {}
  const sets = [], vals = []
  const add = (col, v) => { vals.push(v); sets.push(`${col} = $${vals.length}`) }
  if (status !== undefined) {
    if (!['pendente', 'aprovado', 'rejeitado'].includes(status))
      return res.status(400).json({ error: 'status inválido' })
    add('status', status)
    add('reviewed_by', req.user.id)
    sets.push('reviewed_at = now()')
  }
  if (review_note !== undefined) add('review_note', review_note ? String(review_note).slice(0, 500) : null)
  if (name !== undefined) {
    if (!String(name).trim()) return res.status(400).json({ error: 'nome do local é obrigatório' })
    add('name', String(name).trim().slice(0, 120))
  }
  if (description !== undefined) add('description', description ? String(description).slice(0, 500) : null)
  if (municipio !== undefined) add('municipio', municipio ? String(municipio).trim().slice(0, 80) : null)
  if (lat !== undefined || lon !== undefined) {
    const la = Number(lat), lo = Number(lon)
    if (!Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180)
      return res.status(400).json({ error: 'coordenadas inválidas' })
    add('lat', la); add('lon', lo)
  }
  if (!sets.length) return res.status(400).json({ error: 'nada para atualizar' })
  vals.push(req.params.id)
  const { rows } = await query(
    `UPDATE community_lz SET ${sets.join(', ')} WHERE id = $${vals.length}
     RETURNING id, status`, vals
  )
  if (!rows[0]) return res.status(404).json({ error: 'ponto não encontrado' })
  res.json({ point: rows[0] })
})

// autor exclui a própria sugestão enquanto pendente; admin exclui qualquer uma
app.delete('/api/community-lz/:id', requireAuth, async (req, res) => {
  const { rows } = await query('SELECT created_by, status FROM community_lz WHERE id = $1', [req.params.id])
  if (!rows[0]) return res.status(404).json({ error: 'ponto não encontrado' })
  const own = rows[0].created_by === req.user.id
  if (req.user.role !== 'admin' && !(own && rows[0].status === 'pendente'))
    return res.status(403).json({ error: 'apenas o admin (ou o autor, enquanto pendente) pode excluir' })
  await query('DELETE FROM community_lz WHERE id = $1', [req.params.id])
  res.json({ ok: true })
})

// ---------- admin de usuários ----------
app.get('/api/users', requireAdmin, async (_req, res) => {
  const { rows } = await query(
    'SELECT id, username, full_name, role, active, created_at, last_login_at FROM users ORDER BY username'
  )
  res.json({ users: rows })
})

app.post('/api/users', requireAdmin, async (req, res) => {
  const { username, password, full_name, role } = req.body || {}
  if (!username || !password) return res.status(400).json({ error: 'usuário e senha obrigatórios' })
  if (String(password).length < 6) return res.status(400).json({ error: 'senha deve ter ao menos 6 caracteres' })
  const r = ['admin', 'regulador', 'operador'].includes(role) ? role : 'regulador'
  try {
    const { rows } = await query(
      `INSERT INTO users (username, password_hash, full_name, role)
       VALUES ($1,$2,$3,$4) RETURNING id, username, full_name, role, active, created_at`,
      [String(username).trim(), hashPassword(password), full_name || null, r]
    )
    res.status(201).json({ user: rows[0] })
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'usuário já existe' })
    console.error('create user:', e)
    res.status(500).json({ error: 'erro ao criar usuário' })
  }
})

app.patch('/api/users/:id', requireAdmin, async (req, res) => {
  const { active, role, password, full_name } = req.body || {}
  const sets = [], vals = []
  if (active !== undefined) { vals.push(active); sets.push(`active = $${vals.length}`) }
  if (role && ['admin', 'regulador', 'operador'].includes(role)) { vals.push(role); sets.push(`role = $${vals.length}`) }
  if (full_name !== undefined) { vals.push(full_name); sets.push(`full_name = $${vals.length}`) }
  if (password) {
    if (String(password).length < 6) return res.status(400).json({ error: 'senha deve ter ao menos 6 caracteres' })
    vals.push(hashPassword(password)); sets.push(`password_hash = $${vals.length}`)
  }
  if (!sets.length) return res.status(400).json({ error: 'nada para atualizar' })
  vals.push(req.params.id)
  const { rows } = await query(
    `UPDATE users SET ${sets.join(', ')} WHERE id = $${vals.length}
     RETURNING id, username, full_name, role, active`, vals
  )
  if (!rows[0]) return res.status(404).json({ error: 'usuário não encontrado' })
  if (active === false || password) // sessões deixam de valer ao desativar/trocar senha
    await query('DELETE FROM sessions WHERE user_id = $1', [req.params.id])
  res.json({ user: rows[0] })
})

const PORT = Number(process.env.PORT || 3012)
startSessionGC()
app.listen(PORT, '127.0.0.1', () => console.log(`skyrescue-api ouvindo em 127.0.0.1:${PORT}`))
