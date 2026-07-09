import pg from 'pg'

// Conexão via DATABASE_URL (ex.: postgres://skyrescue:senha@127.0.0.1:5432/skyrescue).
// Postgres é local no EC2 — sem SSL.
const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error('FATAL: DATABASE_URL não definida (ver .env.production)')
  process.exit(1)
}

export const pool = new pg.Pool({
  connectionString,
  max: 10,
  idleTimeoutMillis: 30_000,
})

pool.on('error', (err) => {
  console.error('Erro inesperado no pool do Postgres:', err)
})

export const query = (text, params) => pool.query(text, params)
