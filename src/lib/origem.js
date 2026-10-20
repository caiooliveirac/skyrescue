// ------------------------------------------------------------------
// Decolagem fora da base e LZ fixada — os dois pontos do voo que o
// regulador pode "prender" no caso.
//
// Os dois vão no snapshot como cópia (nome + coordenadas), não como id:
// cada tela tem a SUA Config (localStorage), e um hospital renomeado ou
// apagado num navegador não pode mudar o voo que a outra tela calcula —
// nem o registro de um caso antigo.
// ------------------------------------------------------------------
import { haversineKm } from './geo.js'

// Pontos de onde a aeronave pode sair numa ocorrência emendada: hospitais com
// heliponto próprio (HS, Metropolitano…) e helipontos de apoio (IML…).
export function origemOpcoes(cfg) {
  return [
    ...(cfg.hospitals || []).filter((h) => h.heliponto)
      .map((h) => ({ key: `hosp/${h.id}`, kind: 'hosp', grupo: 'Hospitais com heliponto', name: h.name, lat: h.lat, lon: h.lon })),
    ...(cfg.helipads || [])
      .map((p) => ({ key: `pad/${p.id}`, kind: 'pad', grupo: 'Helipontos de apoio', name: p.name, lat: p.lat, lon: p.lon })),
  ]
}

export const origemDoPonto = (lat, lon) => ({ key: 'mapa', kind: 'mapa', name: 'Ponto marcado no mapa', lat, lon })

// Posição reportada pelo modo navegação do piloto. Congela no momento da
// escolha (o caso não fica recalculando a cada fix); acima de ~50 km/h a
// aeronave está em voo e não há acionamento → decolagem a esperar.
export function origemDaAeronave(acft) {
  const at = new Date(acft.reported_at).getTime()
  const hm = new Date(at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  return {
    key: 'acft', kind: 'acft', name: `Posição do GOA às ${hm}`,
    lat: acft.lat, lon: acft.lon, at, airborne: (acft.gs_kmh ?? 0) > 50,
  }
}

// Ocorrências emendadas: a aeronave está onde pousou o caso anterior. Sugere
// o ponto de pouso do caso mais recente que pousou no destino nas últimas 3 h
// (e não foi cancelado). Se o ponto coincide com uma opção da lista, usa a
// opção — o seletor mostra o nome conhecido.
const EMENDA_MAX_MS = 3 * 3600_000
export function sugestaoEmenda(cases, dbId, opcoes) {
  const agora = Date.now()
  let best = null
  for (const c of cases || []) {
    if (dbId != null && String(c.id) === String(dbId)) continue
    const lp = c.landing_point
    const t = Number(c.pouso_destino_at)
    if (!lp || lp.lat == null || !t || c.cancelado_at) continue
    if (t > agora || agora - t > EMENDA_MAX_MS) continue
    if (!best || t > best.at) best = { caseRef: c.case_ref || `#${c.id}`, at: t, lp }
  }
  if (!best) return null
  const igual = opcoes.find((o) => haversineKm(o, best.lp) * 1000 < 60)
  const origem = igual || { key: 'emenda', kind: 'emenda', name: best.lp.name || 'Pouso do caso anterior', lat: best.lp.lat, lon: best.lp.lon }
  return { caseRef: best.caseRef, at: best.at, origem }
}

// ---------------- LZ fixada ----------------
// Cópia congelada da LZ em vigor: com ela o ponto de encontro sobrevive à
// lista de candidatos ser refeita (cena movida, Overpass de novo) e as letras
// mudarem. Leva o que os alertas e o documento usam.
export const congelaLz = (p) => ({
  id: p.id ?? null,
  lat: p.lat, lon: p.lon,
  name: lzRotulo(p),
  letter: p.letter ?? null,
  type: p.type ?? null,
  obstFlag: !!p.obstFlag, obstWhat: p.obstWhat ?? null, obstNear: p.obstNear ?? null,
})

// nome da LZ para texto: candidato pelo nome (com a letra, se `comLetra`);
// LZ manual pelo nome que tiver (destravar uma LZ que saiu da lista a
// devolve como manual, com o nome dela) ou "LZ manual"
export function lzRotulo(p, comLetra = false) {
  if (!p) return ''
  if (p.id == null) return p.name || 'LZ manual'
  return `${comLetra && p.letter ? p.letter + ' — ' : ''}${p.name || 'LZ'}`
}
