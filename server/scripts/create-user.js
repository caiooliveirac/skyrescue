// CLI para cadastrar/atualizar usuário:
//   node scripts/create-user.js <username> <senha> [role] ["Nome completo"]
// role: admin | regulador | operador  (padrão: regulador)
// Se o usuário já existir, atualiza a senha (e role/nome se informados).
import { query, pool } from '../src/db.js'
import { hashPassword } from '../src/auth.js'

async function main() {
  const [username, password, role = 'regulador', fullName = null] = process.argv.slice(2)
  if (!username || !password) {
    console.error('uso: node scripts/create-user.js <username> <senha> [role] ["Nome"]')
    process.exit(1)
  }
  if (!['admin', 'regulador', 'operador'].includes(role)) {
    console.error(`role inválido: ${role} (use admin|regulador|operador)`); process.exit(1)
  }
  const hash = hashPassword(password)
  const { rows } = await query(
    `INSERT INTO users (username, password_hash, full_name, role)
       VALUES ($1, $2, $3, $4)
     ON CONFLICT (username) DO UPDATE
       SET password_hash = EXCLUDED.password_hash,
           role = EXCLUDED.role,
           full_name = COALESCE(EXCLUDED.full_name, users.full_name),
           active = TRUE
     RETURNING id, username, role, (xmax = 0) AS created`,
    [username.trim(), hash, fullName, role]
  )
  const u = rows[0]
  console.log(`${u.created ? 'criado' : 'atualizado'}: ${u.username} (${u.role}, id ${u.id})`)
  await pool.end()
}

main().catch((e) => { console.error(e); process.exit(1) })
