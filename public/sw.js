// Service worker do SkyRescue: faz o app ABRIR sem rede.
//
// O app é um arquivo só (index.html com JS e CSS embutidos), então a "casca"
// a guardar é uma resposta. Estratégia rede-primeiro: com rede vale sempre a
// versão do servidor (e ela renova a cópia guardada); sem rede — ou com rede
// que não responde em 4 s — sai a última cópia. Nunca segura versão velha
// quando há rede.
//
// Só navegação entra aqui. /api, mapas e meteorologia passam direto: dado de
// paciente não é guardado pelo service worker.
const CACHE = 'skyrescue-casca-v1'
const CASCA = '/'

self.addEventListener('install', (e) => {
  self.skipWaiting()
  e.waitUntil(caches.open(CACHE).then((c) => c.add(new Request(CASCA, { cache: 'reload' }))))
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (e) => {
  const r = e.request
  if (r.method !== 'GET' || r.mode !== 'navigate') return
  if (new URL(r.url).pathname.startsWith('/api/')) return
  const daRede = fetch(r).then((res) => {
    if (res.ok) {
      const copia = res.clone()
      caches.open(CACHE).then((c) => c.put(CASCA, copia))
    }
    return res
  })
  const doCache = () => caches.match(CASCA).then((res) => res || Response.error())
  e.respondWith(
    Promise.race([
      daRede,
      new Promise((_, falha) => setTimeout(() => falha(new Error('rede lenta')), 4000)),
    ]).catch(async () => {
      const guardada = await caches.match(CASCA)
      // sem cópia guardada, o que resta é esperar a rede (lenta) responder
      return guardada || daRede.catch(doCache)
    })
  )
})
