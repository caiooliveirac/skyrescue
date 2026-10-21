import net from 'node:net'

// ---------- IP do cliente ----------
// Caminho real: navegador → Cloudflare → nginx (goa vhost) → API. O nginx manda
// `X-Real-IP $remote_addr` (sobrescreve o que o cliente mandou) e não tem
// real_ip configurado, então X-Real-IP é o salto que conectou no nginx: a borda
// da Cloudflare, ou o próprio cliente se ele bater direto na origem (443 aberta).
// X-Forwarded-For chega como o cliente mandou + o IP que a Cloudflare anexa:
// o primeiro item é do cliente e não vale nada. Regra: se o salto é Cloudflare,
// vale o CF-Connecting-IP (posto pela Cloudflare); senão, o próprio salto.
const CLOUDFLARE = [ // https://www.cloudflare.com/ips/ (mesma lista do snippet do nginx)
  '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '141.101.64.0/18',
  '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20', '197.234.240.0/22', '198.41.128.0/17',
  '162.158.0.0/15', '104.16.0.0/13', '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
  '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32', '2405:8100::/32',
  '2a06:98c0::/29', '2c0f:f248::/32',
]
const cf = new net.BlockList()
for (const r of CLOUDFLARE) {
  const [addr, bits] = r.split('/')
  cf.addSubnet(addr, Number(bits), net.isIPv6(addr) ? 'ipv6' : 'ipv4')
}
const semPrefixo = (ip) => String(ip || '').trim().replace(/^::ffff:/, '')
const ehCloudflare = (ip) => {
  const v = net.isIP(ip)
  return v !== 0 && cf.check(ip, v === 6 ? 'ipv6' : 'ipv4')
}

export function clientIp(req) {
  const salto = semPrefixo(req.headers['x-real-ip']) || semPrefixo(req.socket?.remoteAddress) || req.ip
  if (ehCloudflare(salto)) {
    const real = semPrefixo(req.headers['cf-connecting-ip'])
    if (net.isIP(real)) return real
  }
  return salto
}

// ---------- validação ----------
export const str = (v, max) => (v == null ? '' : String(v)).trim().slice(0, max)
const CENTRAIS_OK = /^[\wÀ-ÿ .'-]{2,40}$/

// Lê e valida o corpo. O LOCAL é o mínimo: com ele o primeiro aviso já sai.
// `completo` exige também quem pede e o que é (a passagem do caso).
export function lerAcionamento(b, completo) {
  const v = {
    central: str(b.central, 40), medico: str(b.medico, 120), fone: str(b.fone, 30),
    tipo: str(b.tipo, 40), detalhe: str(b.detalhe, 300), localTxt: str(b.local, 300),
    pinLabel: str(b.pinLabel, 300), pacNome: str(b.pacienteNome, 120), pacIdade: str(b.pacienteIdade, 40),
    lat: null, lon: null,
  }
  if (!v.localTxt) return { error: 'local da ocorrência obrigatório' }
  if (b.lat != null || b.lon != null) {
    v.lat = Number(b.lat); v.lon = Number(b.lon)
    if (!Number.isFinite(v.lat) || !Number.isFinite(v.lon) || Math.abs(v.lat) > 90 || Math.abs(v.lon) > 180)
      return { error: 'coordenadas inválidas' }
  }
  if (completo) {
    if (!CENTRAIS_OK.test(v.central)) return { error: 'central inválida' }
    if (v.medico.length < 2) return { error: 'nome do médico obrigatório' }
    if (v.fone.replace(/\D/g, '').length < 10) return { error: 'telefone de contato inválido' }
    if (!v.tipo) return { error: 'tipo de ocorrência obrigatório' }
  }
  return { v }
}

// ---------- limite (POST /api/acionamentos) ----------
// Rota pública ⇒ limite por IP e global, para ninguém inundar o grupo da
// regulação a partir de um script. Só pedido VÁLIDO conta: lixo leva 400 sem
// gravar nem avisar ninguém, e não pode gastar o teto global (senão 40 POSTs
// vazios travavam o acionamento de verdade por 1 h).
export const RL_IP_MAX = 5, RL_IP_WINDOW_MS = 10 * 60_000
export const RL_GLOBAL_MAX = 40, RL_GLOBAL_WINDOW_MS = 60 * 60_000

export function criarLimite(agora = Date.now) {
  const rl = { byIp: new Map(), global: [] }
  return function limitar(req, res, next) {
    const now = agora()
    const ip = clientIp(req)
    const hits = (rl.byIp.get(ip) || []).filter((t) => now - t < RL_IP_WINDOW_MS)
    rl.global = rl.global.filter((t) => now - t < RL_GLOBAL_WINDOW_MS)
    if (hits.length >= RL_IP_MAX || rl.global.length >= RL_GLOBAL_MAX) {
      return res.status(429).json({ error: 'muitos acionamentos em sequência — ligue para a regulação' })
    }
    hits.push(now); rl.byIp.set(ip, hits); rl.global.push(now)
    if (rl.byIp.size > 5000) rl.byIp.clear()   // mapa não cresce sem limite
    next()
  }
}

// Sem `tipo` no corpo é o primeiro aviso, só com o endereço.
export function validarAcionamento(req, res, next) {
  const b = req.body || {}
  const completo = !!str(b.tipo, 40)
  const { v, error } = lerAcionamento(b, completo)
  if (error) return res.status(400).json({ error })
  req.acionamento = { v, completo }
  next()
}

// a ordem é a correção do SOUT-26: valida primeiro, conta depois
export const cadeiaAcionamento = (limitar = criarLimite()) => [validarAcionamento, limitar]
