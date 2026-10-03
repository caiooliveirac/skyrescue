// CLI: libera ou tira do usuário a passagem para o portal mnrs.com.br (Mesa do
// plantões e Painel, só leitura — server/src/portal.js):
//   node scripts/acesso-portal.js <username> on|off
//   node scripts/acesso-portal.js --listar
import { query, pool } from '../src/db.js'

async function main() {
  const [username, estado] = process.argv.slice(2)
  if (username === '--listar') {
    const { rows } = await query('SELECT username, full_name, role, active FROM users WHERE acesso_portal ORDER BY username')
    for (const u of rows) console.log(`${u.username}\t${u.full_name || ''}\t${u.role}${u.active ? '' : '\t(inativo)'}`)
    if (!rows.length) console.log('nenhum usuário com acesso ao portal')
  } else {
    if (!username || !['on', 'off'].includes(estado)) {
      console.error('uso: node scripts/acesso-portal.js <username> on|off  |  --listar')
      process.exit(1)
    }
    const { rows } = await query(
      'UPDATE users SET acesso_portal = $2 WHERE lower(username) = lower($1) RETURNING username, acesso_portal',
      [username.trim(), estado === 'on']
    )
    if (!rows[0]) { console.error(`usuário não encontrado: ${username}`); process.exit(1) }
    console.log(`${rows[0].username}: acesso ao portal ${rows[0].acesso_portal ? 'LIBERADO' : 'retirado'}`)
  }
  await pool.end()
}

main().catch((e) => { console.error(e); process.exit(1) })
