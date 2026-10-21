// Trava de ambiente dos test-*.js que gravam no banco: só banco de dev/teste
// (nome terminado em _dev ou _test, como o skyrescue_dev). Confere no próprio
// Postgres, antes de qualquer escrita — vale mesmo com DATABASE_URL de produção
// no .env. Fora disso sai com 2 sem alterar nada.
import { query, pool } from '../src/db.js'

export async function exigirBancoDeTeste() {
  const { rows } = await query('SELECT current_database() AS db')
  const db = rows[0].db
  if (/_(dev|test)$/.test(db)) return
  console.error(`RECUSADO: o banco "${db}" não é de dev/teste (nome precisa terminar em _dev ou _test). Nada foi alterado.`)
  await pool.end()
  process.exit(2)
}
