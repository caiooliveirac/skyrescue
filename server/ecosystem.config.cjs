// PM2 — padrão da casa nesta EC2 (pm2-ubuntu.service gerencia o boot).
// Porta 3012: 3001–3011 já estão ocupadas pelos outros apps do host.
// Env sensível (DATABASE_URL, SESSION_TTL_HOURS) vem de .env.production,
// que NÃO fica no repo — é criado uma vez no servidor.
module.exports = {
  apps: [
    {
      name: 'skyrescue-api',
      cwd: __dirname,
      script: 'src/index.js',
      interpreter: 'node',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '256M',
      env_file: `${__dirname}/.env.production`,
      env: {
        NODE_ENV: 'production',
        PORT: '3012',
      },
    },
  ],
}
