import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

// viteSingleFile embute todo JS/CSS num único index.html:
// o dist/index.html funciona aberto direto do disco (file://), sem servidor.
export default defineConfig(({ mode }) => {
  // terceiro arg '' lê também variáveis sem o prefixo VITE_ —
  // a chave do Google Maps fica no .env como Google_API_KEY
  const env = loadEnv(mode, process.cwd(), '')
  const gmapsKey = env.VITE_GMAPS_KEY || env.Google_API_KEY || env.Google_API_key || ''
  return {
    plugins: [react(), viteSingleFile()],
    // em dev, encaminha /api para a API local (server/, porta 3012; API_PORT
    // muda a porta quando 3012 já está ocupada por outra cópia do projeto)
    server: { proxy: { '/api': `http://127.0.0.1:${env.API_PORT || 3012}` } },
    build: { target: 'es2018', chunkSizeWarningLimit: 4000 },
    define: {
      'import.meta.env.VITE_GMAPS_KEY': JSON.stringify(gmapsKey),
    },
  }
})
