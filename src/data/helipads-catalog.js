// ---------------------------------------------------------------
// Catálogo estático de helipontos registrados (ANAC/CIAD) em
// Salvador, RMS e ilhas da Baía de Todos os Santos.
//
// Fonte: registro ANAC (códigos ICAO/CIAD) — a maioria NÃO está
// mapeada no OpenStreetMap, por isso a busca Overpass não os acha.
// Coordenadas convertidas de DMS; ajuste fino pode ser feito à mão.
//
// ATENÇÃO OPERACIONAL: heliponto registrado ≠ heliponto disponível.
// Helipontos privados (prédios comerciais, condomínios, ilhas)
// exigem coordenação prévia com o operador.
// ---------------------------------------------------------------

import { haversineKm } from '../lib/geo.js'

export const HELIPAD_CATALOG = [
  { icao: 'SICX', ciad: 'BA0192', name: 'Salvador Trade Center', bairro: 'Caminho das Árvores',
    lat: -12.983889, lon: -38.453611 },
  { icao: 'SIIL', ciad: 'BA0194', name: 'Civil Towers', bairro: 'Costa Azul',
    lat: -12.989167, lon: -38.448333 },
  { icao: 'SIUT', ciad: 'BA0196', name: 'Sede da Novonor (ex-Odebrecht)', bairro: 'Cabula',
    lat: -12.9625, lon: -38.435556 },
  { icao: 'SJBD', ciad: 'BA0201', name: 'Mundo Plaza', bairro: 'Caminho das Árvores',
    lat: -12.979661, lon: -38.461314 },
  { icao: 'SJOB', ciad: 'BA0209', name: 'Hospital da Bahia', bairro: 'Pituba',
    lat: -12.9875, lon: -38.450833 },
  { icao: 'SJOC', ciad: 'BA0210', name: 'CEO Salvador Shopping', bairro: 'Caminho das Árvores',
    lat: -12.979444, lon: -38.452222 },
  { icao: 'SNDN', ciad: 'BA0212', name: 'CIGE — Centro Int. de Gestão de Emergências', bairro: 'Centro Administrativo da Bahia',
    lat: -12.943889, lon: -38.425556 },
  { icao: 'SNEM', ciad: 'BA0213', name: 'Enseada', bairro: 'Ilha dos Frades',
    lat: -12.795556, lon: -38.643611 },
  { icao: 'SNSN', ciad: 'BA0215', name: 'Henrimar Táxi Aéreo', bairro: 'Nova Esperança (Barragem Ipitanga)',
    lat: -12.87, lon: -38.365833 },
  { icao: 'SSMD', ciad: 'BA0220', name: 'Maremanga', bairro: 'Ilha do Bom Jesus dos Passos',
    lat: -12.763333, lon: -38.643889 },
  { icao: 'SSRI', ciad: 'BA0222', name: 'Ilhota dos Coqueiros', bairro: 'Ilhota dos Coqueiros',
    lat: -12.766389, lon: -38.65 },
  { icao: 'SSWW', ciad: 'BA0224', name: 'VR Aviation', bairro: 'Brotas (Parque Bela Vista)',
    lat: -12.981667, lon: -38.468889 },
  { icao: 'SWDA', ciad: 'BA0228', name: 'Assembleia Legislativa da Bahia', bairro: 'Centro Administrativo da Bahia',
    lat: -12.9475, lon: -38.431944 },
  { icao: 'SWDL', ciad: 'BA0229', name: 'Del Rey', bairro: 'Jardim Armação',
    lat: -12.992778, lon: -38.44 },
  { icao: 'SWLT', ciad: 'BA0232', name: 'Loreto', bairro: 'Ilha dos Frades',
    lat: -12.759722, lon: -38.620556 },
  { icao: 'SWOD', ciad: 'BA0234', name: 'Palácio de Ondina', bairro: 'Ondina',
    lat: -13.009167, lon: -38.503889 },
  { icao: 'SWRR', ciad: 'BA0235', name: 'RR76 Clube Espanhol', bairro: 'Barra',
    lat: -13.009444, lon: -38.520278 },
  { icao: 'SWVA', ciad: 'BA0236', name: 'Hospital Municipal de Salvador', bairro: 'Boca da Mata',
    lat: -12.8975, lon: -38.389444 },
  { icao: 'SSDE', ciad: 'BA0316', name: 'Hospital Cárdio Pulmonar', bairro: 'Federação',
    lat: -13.006111, lon: -38.500278 },
]

// helipontos do catálogo dentro do raio (em metros) a partir de um ponto
export function catalogNear(point, radiusM) {
  if (!point) return []
  return HELIPAD_CATALOG.filter((h) => haversineKm(point, h) * 1000 <= radiusM)
}
