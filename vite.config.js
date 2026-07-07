import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

// viteSingleFile embute todo JS/CSS num único index.html:
// o dist/index.html funciona aberto direto do disco (file://), sem servidor.
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: { target: 'es2018', chunkSizeWarningLimit: 4000 }
})
