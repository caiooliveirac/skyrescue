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
  createCase: (snapshot) => req('POST', '/cases', { snapshot }),
  updateCase: (id, snapshot) => req('PUT', `/cases/${id}`, { snapshot }),
  deleteCase: (id) => req('DELETE', `/cases/${id}`),
  // pontos de pouso da comunidade
  listCommunityLz: () => req('GET', '/community-lz'),
  createCommunityLz: (p) => req('POST', '/community-lz', p),
  updateCommunityLz: (id, patch) => req('PATCH', `/community-lz/${id}`, patch),
  deleteCommunityLz: (id) => req('DELETE', `/community-lz/${id}`),
  // admin
  listUsers: () => req('GET', '/users'),
  createUser: (u) => req('POST', '/users', u),
  updateUser: (id, patch) => req('PATCH', `/users/${id}`, patch),
}
