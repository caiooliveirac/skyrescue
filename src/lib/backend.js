// Cliente da API do SkyRescue. Mesma origem em produção (nginx faz proxy de
// /api → 127.0.0.1:3012); em dev o Vite faz proxy (ver vite.config.js).
// O cookie de sessão (httpOnly) é enviado automaticamente com credentials.
const BASE = '/api'

async function req(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  let data = null
  try { data = await res.json() } catch (e) { /* sem corpo */ }
  if (!res.ok) {
    const err = new Error(data?.error || `HTTP ${res.status}`)
    err.status = res.status
    throw err
  }
  return data
}

export const api = {
  // auth
  me: () => req('GET', '/auth/me'),
  login: (username, password) => req('POST', '/auth/login', { username, password }),
  logout: () => req('POST', '/auth/logout'),
  changePassword: (currentPassword, newPassword) =>
    req('POST', '/auth/password', { currentPassword, newPassword }),
  // casos
  listCases: () => req('GET', '/cases'),
  getCase: (id) => req('GET', `/cases/${id}`),
  createCase: (snapshot, clientId) => req('POST', '/cases', { snapshot, clientId }),
  updateCase: (id, snapshot, opts = {}) =>
    req('PUT', `/cases/${id}`, { snapshot, clientId: opts.clientId }),
  // gravação automática da tela ao vivo: só os campos que ESTA tela mudou, para
  // duas pessoas na mesma ocorrência não apagarem o campo uma da outra
  patchCase: (id, fields, clientId) =>
    req('PATCH', `/cases/${id}/live`, { fields, clientId }),
  deleteCase: (id) => req('DELETE', `/cases/${id}`),
  // ficha do paciente: caminho próprio, separado do snapshot, para a PII não
  // trafegar no poll de 5 s nem no briefing do bot. Gravação por campo pela
  // mesma razão do patchCase — duas telas escrevendo na mesma ficha.
  getPatient: (id) => req('GET', `/cases/${id}/patient`),
  patchPatient: (id, fields, clientId) =>
    req('PATCH', `/cases/${id}/patient`, { fields, clientId }),
  notifyCase: (id) => req('POST', `/cases/${id}/notify`),
  saveEvent: (id, event, ts) => req('POST', `/cases/${id}/events`, { event, ts }),
  liveCase: (id, since) => req('GET', `/cases/${id}/live${since ? `?since=${encodeURIComponent(since)}` : ''}`),
  // pontos de pouso da comunidade
  listCommunityLz: () => req('GET', '/community-lz'),
  createCommunityLz: (p) => req('POST', '/community-lz', p),
  updateCommunityLz: (id, patch) => req('PATCH', `/community-lz/${id}`, patch),
  deleteCommunityLz: (id) => req('DELETE', `/community-lz/${id}`),
  // fotos de qualquer ponto de pouso ("como o local é"). `ref` é o mesmo
  // identificador dos candidatos a LZ: cat/SBSV, hosp/hge, pad/iml, com/12…
  listLzPhotos: (ref) => req('GET', `/lz-photos?ref=${encodeURIComponent(ref)}`),
  addLzPhoto: (photo) => req('POST', '/lz-photos', photo),
  deleteLzPhoto: (pid) => req('DELETE', `/lz-photos/${pid}`),
  lzPhotoCounts: () => req('GET', '/lz-photos/counts'),
  // URL da imagem para usar direto no <img> (o cookie de sessão vai junto)
  lzPhotoUrl: (pid) => `${BASE}/lz-photos/${pid}`,
  // rastreamento da aeronave
  reportAircraft: (p) => req('POST', '/aircraft/position', p),
  getAircraft: () => req('GET', '/aircraft/position'),
  // admin
  listUsers: () => req('GET', '/users'),
  createUser: (u) => req('POST', '/users', u),
  updateUser: (id, patch) => req('PATCH', `/users/${id}`, patch),
}
