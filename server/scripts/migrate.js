// Aplica o schema (idempotente) e faz o seed do admin inicial se não houver usuários.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { query, pool } from '../src/db.js'
import { hashPassword } from '../src/auth.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

async function main() {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8')
  await query(sql)
  console.log('schema aplicado.')

  // missões que ninguém encerrou (o marco "Aeronave liberada" não foi marcado)
  // continuariam sendo a "missão ativa" do bot para sempre — o /caso e os
  // avisos de deslocamento passariam a falar de um caso de dias atrás. Mesmo
  // teto usado em runtime pela varredura do bot (telegram.js).
  const ttlH = Number(process.env.MISSION_TTL_HOURS) || 12
  const stale = await query(
    `UPDATE mission_chat SET status = 'encerrada'
      WHERE status = 'ativa' AND created_at < now() - make_interval(hours => $1)
      RETURNING case_id`,
    [ttlH]
  )
  if (stale.rows.length) {
    console.log(`missões órfãs encerradas (>${ttlH}h sem 'Aeronave liberada'): caso(s) ${stale.rows.map((r) => r.case_id).join(', ')}`)
  }

  const { rows } = await query('SELECT count(*)::int AS n FROM users')
  if (rows[0].n === 0) {
    const username = process.env.SEED_ADMIN_USER || 'goa.samu'
    const password = process.env.SEED_ADMIN_PASS || 'samu@192'
    await query(
      `INSERT INTO users (username, password_hash, full_name, role)
       VALUES ($1, $2, $3, 'admin')`,
      [username, hashPassword(password), 'Administrador GOA']
    )
    console.log(`admin inicial criado: ${username} (troque a senha após o primeiro acesso).`)
  } else {
    console.log(`usuários já existentes (${rows[0].n}) — seed do admin ignorado.`)
  }
  await pool.end()
}

main().catch((e) => { console.error(e); process.exit(1) })
