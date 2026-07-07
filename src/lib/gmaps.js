// Carrega o script do Google Maps JS API uma única vez (necessário para a
// camada de satélite oficial via leaflet.gridlayer.googlemutant).
let gPromise = null

// O Google sinaliza falha de autorização (chave inválida, API não habilitada,
// domínio não autorizado) DEPOIS do script carregar, via window.gm_authFailure.
// Sem tratar isso o mapa fica preto em vez de cair no fallback.
let authFailed = false
const authListeners = new Set()
if (typeof window !== 'undefined') {
  window.gm_authFailure = () => {
    authFailed = true
    console.warn('[skyrescue] Google Maps recusou a chave (ver erro acima) — usando satélite Esri')
    authListeners.forEach((fn) => { try { fn() } catch (e) { /* ok */ } })
  }
}

export function googleAuthFailed() { return authFailed }
export function onGoogleAuthFailure(fn) {
  authListeners.add(fn)
  return () => authListeners.delete(fn)
}

export function loadGoogleMaps(key) {
  if (window.google?.maps?.Map) return Promise.resolve(window.google.maps)
  if (gPromise) return gPromise
  gPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&language=pt-BR&region=BR`
    s.async = true
    s.onload = () => {
      if (window.google?.maps?.Map) resolve(window.google.maps)
      else reject(new Error('Google Maps não inicializou'))
    }
    s.onerror = () => {
      gPromise = null
      reject(new Error('falha ao carregar Google Maps (chave inválida ou sem rede)'))
    }
    document.head.appendChild(s)
  })
  return gPromise
}
