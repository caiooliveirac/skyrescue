// ---------------------------------------------------------------
// SkyRescue — configuração padrão (tudo editável na tela ⚙ Config)
// Coordenadas marcadas como verified:false são APROXIMADAS e devem
// ser confirmadas pela equipe (arrastar marcador / buscar endereço).
//
// Helipontos em Salvador/RMS (informação operacional SAMU 192):
// - Heliponto NO PRÓPRIO hospital: Subúrbio, Metropolitano e
//   Hospital Municipal de Salvador.
// - HGE (grande centro de trauma) NÃO tem heliponto próprio:
//   usa o heliponto do IML Nina Rodrigues ou do Hospital Mater Dei.
// - Rede privada com heliponto que empresta mediante coordenação:
//   Hospital Aliança e Hospital Cardio Pulmonar.
// ---------------------------------------------------------------

export const CFG_KEY = 'skyrescue_cfg_v2'

export const DEFAULTS = {
  base: {
    name: 'Base GOA/CBMBA — CIA, Simões Filho',
    lat: -12.7805,
    lon: -38.4023,
    verified: false,
  },
  aircraft: {
    model: 'AS350 B2 Esquilo',
    cruiseKmh: 200,      // velocidade de cruzeiro
    routeFactor: 1.05,   // rota real ≈ 5% maior que a linha reta
    rangeKm: 550,        // alcance útil aproximado (ida+volta deve caber em 80%)
  },
  times: {
    acionamentoMin: 10,       // decisão -> decolagem
    embarqueMin: 10,          // pouso na cena -> decolagem com paciente
    desembarqueMin: 5,        // pouso em heliponto do hospital -> entrega
    transbordoMin: 15,        // pouso em heliponto de apoio/LZ + ambulância até o hospital
    cenaMin: 15,              // tempo de atendimento na cena (via terrestre)
    pickupStopMin: 7,         // parada p/ embarcar equipe SAMU em heliponto intermediário
  },
  ground: {
    trafficFactor: 1.25, // OSRM não considera trânsito em tempo real
  },
  map: {
    // Chave do Google Maps JS API (opcional): habilita satélite/híbrido do
    // Google — imagem mais atual. Sem chave, cai no Esri World Imagery.
    // Pode vir embutida no build via secret VITE_GMAPS_KEY.
    googleKey: import.meta.env.VITE_GMAPS_KEY || '',
  },
  ops: {
    nightAllowed: false,   // GOA opera VFR diurno
    sunsetMarginMin: 20,   // margem antes do pôr do sol
    lzRadiusM: 1500,       // raio de busca de áreas de pouso
    pickupEnabled: false,  // embarcar equipe SAMU em heliponto intermediário
    pickupHospitalId: 'metropolitano',
  },

  // Helipontos que NÃO ficam dentro de hospital de destino do SUS,
  // usados para desembarque + transbordo curto de ambulância.
  helipads: [
    { id: 'iml', name: 'Heliponto IML Nina Rodrigues', kind: 'apoio',
      addr: 'Instituto Médico Legal Nina Rodrigues, Brotas, Salvador - BA',
      lat: -12.989, lon: -38.488, verified: false,
      note: 'Apoio padrão ao HGE — transbordo curto de ambulância.' },
    { id: 'materdei', name: 'Heliponto Hospital Mater Dei', kind: 'privado',
      addr: 'Hospital Mater Dei Salvador - BA',
      lat: -12.986, lon: -38.462, verified: false,
      note: 'Rede privada — apoio ao HGE mediante coordenação prévia.' },
    { id: 'alianca', name: 'Heliponto Hospital Aliança', kind: 'privado',
      addr: 'Hospital Aliança, Av. Juracy Magalhães Júnior, Rio Vermelho, Salvador - BA',
      lat: -13.0, lon: -38.489, verified: false,
      note: 'Rede privada de alto padrão — empresta mediante coordenação.' },
    { id: 'cardiopulmonar', name: 'Heliponto Hospital Cardio Pulmonar', kind: 'privado',
      addr: 'Hospital Cardio Pulmonar, Av. Anita Garibaldi, Salvador - BA',
      lat: -13.003, lon: -38.508, verified: false,
      note: 'Rede privada de alto padrão — empresta mediante coordenação.' },
  ],

  hospitals: [
    { id: 'hge', name: 'HGE — Hospital Geral do Estado', tags: ['trauma', 'neuro', 'queimados'],
      addr: 'Av. Vasco da Gama, s/n, Brotas, Salvador - BA',
      lat: -12.9889, lon: -38.4879, heliponto: false, helipadIds: ['iml', 'materdei'], verified: false,
      note: 'Grande centro de trauma. Sem heliponto próprio: desembarque no IML Nina Rodrigues ou Mater Dei + transbordo.' },
    { id: 'metropolitano', name: 'Hospital Metropolitano', tags: ['trauma', 'neuro'],
      addr: 'Estrada do Coco (Av. Luiz Tarquínio Pontes), Lauro de Freitas - BA',
      lat: -12.8899, lon: -38.3225, heliponto: true, verified: false,
      note: 'Heliponto próprio operacional; usado pelo GOA para embarque de equipe SAMU.' },
    { id: 'municipal', name: 'Hospital Municipal de Salvador', tags: ['trauma'],
      addr: 'Hospital Municipal de Salvador, Boca da Mata/Cajazeiras, Salvador - BA',
      lat: -12.899, lon: -38.399, heliponto: true, verified: false,
      note: 'Heliponto próprio operacional.' },
    { id: 'hgrs', name: 'Hospital Geral Roberto Santos', tags: ['avc', 'neuro', 'hemodinamica'],
      addr: 'Rua Direta do Saboeiro, s/n, Cabula, Salvador - BA',
      lat: -12.9481, lon: -38.4666, heliponto: false, verified: false,
      note: 'Referência AVC/neuro. Sem heliponto próprio: pouso em LZ ou heliponto de apoio + transbordo.' },
    { id: 'ananery', name: 'Hospital Ana Nery', tags: ['iam', 'hemodinamica'],
      addr: 'Rua Saldanha Marinho, s/n, Caixa D’Água, Salvador - BA',
      lat: -12.96, lon: -38.48, heliponto: false, verified: false,
      note: 'Referência cardiologia / hemodinâmica.' },
    { id: 'suburbio', name: 'Hospital do Subúrbio', tags: ['trauma'],
      addr: 'Av. Afrânio Peixoto (Suburbana), Periperi, Salvador - BA',
      lat: -12.88, lon: -38.47, heliponto: true, verified: false,
      note: 'Porta de urgência/trauma do Subúrbio. Heliponto próprio operacional.' },
    { id: 'martagao', name: 'Hospital Martagão Gesteira', tags: ['ped'],
      addr: 'Rua José Duarte, Tororó, Salvador - BA',
      lat: -12.9843, lon: -38.5027, heliponto: false, verified: false,
      note: 'Referência pediátrica.' },
    { id: 'iperba', name: 'IPERBA — Inst. de Perinatologia da Bahia', tags: ['obst'],
      addr: 'IPERBA, Salvador - BA',
      lat: -12.99, lon: -38.47, heliponto: false, verified: false,
      note: 'Referência obstétrica.' },
  ],
  ambBases: [], // bases SAMU opcionais: {id, name, lat, lon}
}

export const TAG_LABELS = {
  trauma: 'Trauma', neuro: 'Neurocirurgia', hemodinamica: 'Hemodinâmica',
  iam: 'IAM/Cardio', avc: 'AVC', queimados: 'Queimados', ped: 'Pediatria',
  obst: 'Obstetrícia',
}

export const HELIPAD_KIND_LABELS = {
  apoio: 'apoio',
  privado: 'rede privada',
}

// heliponto de apoio associado a um hospital (1º da lista = padrão)
export function hospitalHelipads(cfg, hospital) {
  if (!hospital || hospital.heliponto || !hospital.helipadIds?.length) return []
  return hospital.helipadIds
    .map((id) => (cfg.helipads || []).find((p) => p.id === id))
    .filter(Boolean)
}

// lista salva pelo usuário tem prioridade total (calibração manual);
// itens novos dos DEFAULTS (por id) são anexados para não sumirem em updates.
function mergeListById(defaults, saved) {
  const have = new Set((saved || []).map((x) => x.id))
  return [...(saved || []), ...defaults.filter((d) => !have.has(d.id)).map((d) => JSON.parse(JSON.stringify(d)))]
}

function deepMerge(base, over) {
  if (Array.isArray(base) || Array.isArray(over)) return over !== undefined ? over : base
  if (typeof base === 'object' && base && typeof over === 'object' && over) {
    const out = { ...base }
    for (const k of Object.keys(over)) out[k] = deepMerge(base[k], over[k])
    return out
  }
  return over !== undefined ? over : base
}

export function loadCfg() {
  try {
    const s = localStorage.getItem(CFG_KEY)
    if (s) {
      const c = JSON.parse(s)
      const merged = deepMerge(JSON.parse(JSON.stringify(DEFAULTS)), c)
      merged.hospitals = mergeListById(DEFAULTS.hospitals, merged.hospitals)
      merged.helipads = mergeListById(DEFAULTS.helipads, merged.helipads)
      return merged
    }
  } catch (e) { /* storage indisponível */ }
  return JSON.parse(JSON.stringify(DEFAULTS))
}

export function saveCfg(c) {
  try { localStorage.setItem(CFG_KEY, JSON.stringify(c)) } catch (e) { /* ok */ }
}

export const CASES_KEY = 'skyrescue_cases_v1'
export function loadCases() {
  try { return JSON.parse(localStorage.getItem(CASES_KEY) || '[]') } catch (e) { return [] }
}
export function saveCases(list) {
  try { localStorage.setItem(CASES_KEY, JSON.stringify(list)) } catch (e) { /* ok */ }
}
