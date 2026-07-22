import express from 'express'
import cookieParser from 'cookie-parser'
import { query, pool } from './db.js'
import {
  hashPassword, verifyPassword, createSession, destroySession,
  cookieOptions, authMiddleware, requireAuth, requireAdmin,
  COOKIE_NAME, startSessionGC,
} from './auth.js'
import { startBot, notifyMission, postMilestones, MILESTONES } from './telegram.js'

const app = express()
app.set('trust proxy', 1) // atrás do nginx/Cloudflare
// upload de foto de ponto de pouso: corpo maior que o resto da API. Precisa vir
// ANTES do parser global — o body-parser marca req._body e o seguinte não reprocessa.
// O teto de 3 MB é folga: o cliente já manda <500 kB (ver src/lib/photo.js).
app.use('/api/community-lz/:id/photos', express.json({ limit: '3mb' }))
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
    // eventos anteriores: o bot ecoa no grupo só os horários novos/ajustados
    const prev = await client.query(`SELECT snapshot->'events' AS events FROM cases WHERE id = $1`, [req.params.id])
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

    // fora da transação e sem bloquear a resposta
    const before = prev.rows[0]?.events || {}
    const after = snapshot.events || {}
    const changed = Object.entries(after)
      .filter(([id, ts]) => ts && before[id] !== ts)
      .map(([id, ts]) => ({ id, ts, edited: before[id] != null }))
    if (changed.length) {
      postMilestones(req.params.id, changed, req.user.full_name || req.user.username)
        .catch((e) => console.error('bot milestones:', e.message))
    }
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

// ---------- bot da missão ----------
// marco do acompanhamento marcado/ajustado no app: grava direto no snapshot
// do servidor e ecoa no grupo NA HORA — sem depender do "Atualizar caso"
const MILESTONE_IDS = new Set(MILESTONES.map((m) => m.id))
app.post('/api/cases/:id/events', requireAuth, async (req, res) => {
  const { event, ts } = req.body || {}
  const t = Number(ts)
  if (!MILESTONE_IDS.has(event)) return res.status(400).json({ error: 'marco inválido' })
  if (!Number.isFinite(t) || t <= 0) return res.status(400).json({ error: 'horário inválido' })
  try {
    const prev = await query(
      `SELECT case_ref, snapshot->'events'->>$2 AS old_ts FROM cases WHERE id = $1`,
      [req.params.id, event]
    )
    if (!prev.rows[0]) return res.status(404).json({ error: 'caso não encontrado' })
    const old = prev.rows[0].old_ts != null ? Number(prev.rows[0].old_ts) : null
    if (old === t) return res.json({ ok: true, unchanged: true })
    await query(
      `UPDATE cases SET
         snapshot = jsonb_set(
           jsonb_set(snapshot, '{events}', coalesce(snapshot->'events', '{}'::jsonb), true),
           ARRAY['events', $2::text], to_jsonb($3::bigint), true),
         updated_at = now(), updated_by = $4
       WHERE id = $1`,
      [req.params.id, event, t, req.user.id]
    )
    await query(
      'INSERT INTO case_audit (case_id, user_id, action, case_ref) VALUES ($1,$2,$3,$4)',
      [req.params.id, req.user.id, 'update', prev.rows[0].case_ref]
    )
    res.json({ ok: true })
    postMilestones(req.params.id, [{ id: event, ts: t, edited: old != null }], req.user.full_name || req.user.username)
      .catch((e) => console.error('bot milestone:', e.message))
  } catch (e) {
    console.error('save event:', e)
    res.status(500).json({ error: 'erro ao registrar horário' })
  }
})

// aciona o grupo: briefing + preparação do encontro + cobrança da passagem
app.post('/api/cases/:id/notify', requireAuth, async (req, res) => {
  const { rows } = await query('SELECT id, snapshot FROM cases WHERE id = $1', [req.params.id])
  if (!rows[0]) return res.status(404).json({ error: 'caso não encontrado' })
  try {
    await notifyMission(rows[0], rows[0].snapshot || {}, req.user)
    res.json({ ok: true })
  } catch (e) {
    console.error('notify mission:', e.message)
    res.status(409).json({ error: e.message })
  }
})

// ---------- pontos de pouso da comunidade ----------
// qualquer usuário logado sugere; admin valida ('aprovado') ou rejeita.
// rejeitados só aparecem para o admin e para o próprio autor.
app.get('/api/community-lz', requireAuth, async (req, res) => {
  const { rows } = await query(
    `SELECT z.id, z.name, z.description, z.municipio, z.lat, z.lon, z.status,
            z.created_at, z.created_by, z.reviewed_at, z.review_note,
            cu.username AS created_by_username, cu.full_name AS created_by_name,
            ru.username AS reviewed_by_username, ru.full_name AS reviewed_by_name,
            -- contagem + capa numa passada só: o mapa mostra o selo de "tem foto"
            -- sem uma requisição por ponto
            (SELECT count(*)::int FROM lz_photo p WHERE p.lz_id = z.id) AS photo_count,
            (SELECT p.id FROM lz_photo p WHERE p.lz_id = z.id
              ORDER BY p.created_at LIMIT 1) AS cover_photo_id
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

// ---------- fotos dos pontos de pouso ----------
// "como o local é": quem já pousou fotografa o ponto e anexa. Qualquer usuário
// logado pode anexar (é o conhecimento da equipe que interessa); apagar, só quem
// enviou ou o admin. A imagem já chega reduzida do navegador — aqui só validamos.
const PHOTO_MIMES = new Set(['image/jpeg', 'image/webp', 'image/png'])
const MAX_PHOTO_BYTES = 2 * 1024 * 1024
const MAX_PHOTOS_PER_LZ = 12

// data URL -> {mime, buf}; rejeita qualquer coisa fora do formato esperado
const decodeDataUrl = (s) => {
  const m = /^data:([\w/+.-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(String(s || ''))
  if (!m || !PHOTO_MIMES.has(m[1])) return null
  const buf = Buffer.from(m[2], 'base64')
  return buf.length ? { mime: m[1], buf } : null
}

app.get('/api/community-lz/:id/photos', requireAuth, async (req, res) => {
  const { rows } = await query(
    `SELECT p.id, p.mime, p.size_bytes, p.width, p.height, p.caption,
            p.taken_at, p.created_at, p.created_by,
            u.username AS created_by_username, u.full_name AS created_by_name
       FROM lz_photo p
       LEFT JOIN users u ON u.id = p.created_by
      WHERE p.lz_id = $1
      ORDER BY p.created_at`,
    [req.params.id]
  )
  res.json({ photos: rows })
})

// bytes da imagem. O <img> manda o cookie de sessão sozinho (mesma origem);
// o conteúdo nunca muda, então pode ficar em cache privado por bastante tempo.
app.get('/api/community-lz/:id/photos/:pid', requireAuth, async (req, res) => {
  const { rows } = await query(
    'SELECT mime, bytes FROM lz_photo WHERE id = $1 AND lz_id = $2',
    [req.params.pid, req.params.id]
  )
  if (!rows[0]) return res.status(404).json({ error: 'foto não encontrada' })
  res.set('Content-Type', rows[0].mime)
  res.set('Cache-Control', 'private, max-age=604800, immutable')
  res.send(rows[0].bytes)
})

app.post('/api/community-lz/:id/photos', requireAuth, async (req, res) => {
  const { dataUrl, caption, width, height, takenAt } = req.body || {}
  const img = decodeDataUrl(dataUrl)
  if (!img) return res.status(400).json({ error: 'imagem inválida — envie JPEG, WebP ou PNG' })
  if (img.buf.length > MAX_PHOTO_BYTES) return res.status(413).json({ error: 'imagem muito grande' })
  try {
    const lz = await query('SELECT id FROM community_lz WHERE id = $1', [req.params.id])
    if (!lz.rows[0]) return res.status(404).json({ error: 'ponto não encontrado' })
    const n = await query('SELECT count(*)::int AS n FROM lz_photo WHERE lz_id = $1', [req.params.id])
    if (n.rows[0].n >= MAX_PHOTOS_PER_LZ)
      return res.status(409).json({ error: `limite de ${MAX_PHOTOS_PER_LZ} fotos por ponto` })
    const int = (v) => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : null)
    const when = takenAt && Number.isFinite(Number(takenAt)) ? new Date(Number(takenAt)) : null
    const { rows } = await query(
      `INSERT INTO lz_photo (lz_id, mime, bytes, size_bytes, width, height, caption, taken_at, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, created_at`,
      [req.params.id, img.mime, img.buf, img.buf.length, int(width), int(height),
       caption ? String(caption).slice(0, 200) : null, when, req.user.id]
    )
    res.status(201).json({ id: rows[0].id, created_at: rows[0].created_at })
  } catch (e) {
    console.error('upload lz photo:', e)
    res.status(500).json({ error: 'erro ao salvar foto' })
  }
})

app.delete('/api/community-lz/:id/photos/:pid', requireAuth, async (req, res) => {
  const { rows } = await query(
    'SELECT created_by FROM lz_photo WHERE id = $1 AND lz_id = $2',
    [req.params.pid, req.params.id]
  )
  if (!rows[0]) return res.status(404).json({ error: 'foto não encontrada' })
  if (req.user.role !== 'admin' && rows[0].created_by !== req.user.id)
    return res.status(403).json({ error: 'apenas quem enviou (ou o admin) pode excluir a foto' })
  await query('DELETE FROM lz_photo WHERE id = $1', [req.params.pid])
  res.json({ ok: true })
})

// ---------- rastreamento da aeronave ----------
// o modo navegação do piloto reporta; qualquer autenticado consulta.
app.post('/api/aircraft/position', requireAuth, async (req, res) => {
  const { lat, lon, gsKmh, track, accM } = req.body || {}
  const la = Number(lat), lo = Number(lon)
  if (!Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180)
    return res.status(400).json({ error: 'coordenadas inválidas' })
  const num = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v))
  try {
    await query(
      `INSERT INTO aircraft_position (aircraft_id, lat, lon, gs_kmh, track, acc_m, reported_by, reported_at)
       VALUES ('goa', $1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (aircraft_id) DO UPDATE SET
         lat = EXCLUDED.lat, lon = EXCLUDED.lon, gs_kmh = EXCLUDED.gs_kmh,
         track = EXCLUDED.track, acc_m = EXCLUDED.acc_m,
         reported_by = EXCLUDED.reported_by, reported_at = now()`,
      [la, lo, num(gsKmh), num(track), num(accM), req.user.id]
    )
    res.json({ ok: true })
  } catch (e) {
    console.error('report aircraft:', e)
    res.status(500).json({ error: 'erro ao registrar posição' })
  }
})

app.get('/api/aircraft/position', requireAuth, async (_req, res) => {
  const { rows } = await query(
    `SELECT a.lat, a.lon, a.gs_kmh, a.track, a.acc_m, a.reported_at,
            u.username AS reported_by_username, u.full_name AS reported_by_name
       FROM aircraft_position a
       LEFT JOIN users u ON u.id = a.reported_by
      WHERE a.aircraft_id = 'goa'`
  )
  res.json({ position: rows[0] || null })
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
startBot()
app.listen(PORT, '127.0.0.1', () => console.log(`skyrescue-api ouvindo em 127.0.0.1:${PORT}`))
