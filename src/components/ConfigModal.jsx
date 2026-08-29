import { useState } from 'react'
import { DEFAULTS, TAG_LABELS } from '../config.js'
import { geocode, parseMapsLink, reverseGeocode } from '../lib/api.js'
import { api } from '../lib/backend.js'
import { IconSettings, IconX, IconSearch } from './Icons.jsx'

// input numérico bufferizado: aceita estados intermediários ("", "-", "-12.")
// sem converter em 0; só propaga quando o texto é um número válido.
function NumInput({ value, onChange, ...rest }) {
  const [text, setText] = useState(String(value))
  const [editing, setEditing] = useState(false)
  return (
    <input
      type="number"
      {...rest}
      value={editing ? text : String(value)}
      onFocus={() => { setEditing(true); setText(String(value)) }}
      onBlur={() => setEditing(false)}
      onChange={(e) => {
        setText(e.target.value)
        const n = Number(e.target.value)
        if (e.target.value !== '' && Number.isFinite(n)) onChange(n)
      }}
    />
  )
}

function Num({ label, value, onChange, step = 1, suffix }) {
  return (
    <div className="field">
      <label>{label}{suffix ? ` (${suffix})` : ''}</label>
      <NumInput step={step} value={value} onChange={onChange} />
    </div>
  )
}

export default function ConfigModal({ cfg, onSave, onClose }) {
  const [c, setC] = useState(() => JSON.parse(JSON.stringify(cfg)))
  const [busyGeo, setBusyGeo] = useState(null)
  const [mapsLink, setMapsLink] = useState('')

  // cria hospital a partir de link do Google Maps (completo ou curto) ou "lat, lon"
  const addFromMaps = async () => {
    let text = mapsLink.trim()
    if (!text) return
    setBusyGeo('maps')
    try {
      if (/(maps\.app\.goo\.gl|goo\.gl|g\.co)\//.test(text)) {
        text = (await api.expandUrl(text)).url
      }
      const p = parseMapsLink(text)
      if (!p) {
        alert('Não achei coordenadas nesse link. Cole o link do local (botão "Compartilhar" no Maps, ou a URL completa da barra de endereço).')
        return
      }
      const addr = await reverseGeocode(p.lat, p.lon)
      setC((prev) => ({
        ...prev,
        hospitals: [...prev.hospitals, {
          id: 'h' + Date.now(), name: p.name || 'Novo hospital', tags: [],
          addr: addr || '', lat: p.lat, lon: p.lon,
          heliponto: false, helipadIds: [], verified: true,
        }],
      }))
      setMapsLink('')
    } catch (e) {
      alert('Falha ao ler o link: ' + (e.message || e))
    } finally {
      setBusyGeo(null)
    }
  }

  const set = (path, val) => {
    setC((prev) => {
      const next = JSON.parse(JSON.stringify(prev))
      const keys = path.split('.')
      let o = next
      for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]]
      o[keys[keys.length - 1]] = val
      return next
    })
  }

  const geocodeInto = async (q, apply, key) => {
    if (!q) return
    setBusyGeo(key)
    try {
      const r = await geocode(q)
      if (r.length) apply(r[0])
      else alert('Endereço não encontrado.')
    } catch (e) {
      alert('Falha na geocodificação: ' + e)
    } finally {
      setBusyGeo(null)
    }
  }

  // updaters funcionais (leem prev, não a closure): várias chamadas em
  // sequência — ex.: lat+lon+verified vindos do geocode — compõem corretamente.
  const setHosp = (i, k, v) =>
    setC((prev) => ({ ...prev, hospitals: prev.hospitals.map((h, j) => (j === i ? { ...h, [k]: v } : h)) }))

  const setPad = (i, k, v) =>
    setC((prev) => ({ ...prev, helipads: (prev.helipads || []).map((p, j) => (j === i ? { ...p, [k]: v } : p)) }))

  const removePad = (id) =>
    setC((prev) => ({
      ...prev,
      helipads: (prev.helipads || []).filter((x) => x.id !== id),
      // remove referências órfãs nos hospitais
      hospitals: prev.hospitals.map((h) =>
        h.helipadIds?.includes(id) ? { ...h, helipadIds: h.helipadIds.filter((x) => x !== id) } : h
      ),
    }))

  // corrige pickup apontando p/ hospital sem heliponto/excluído antes de salvar
  const sanitizeAndSave = () => {
    const next = JSON.parse(JSON.stringify(c))
    if (next.ops.pickupEnabled) {
      const elig = next.hospitals.filter((h) => h.heliponto)
      if (!elig.some((h) => h.id === next.ops.pickupHospitalId)) {
        if (elig.length) next.ops.pickupHospitalId = elig[0].id
        else next.ops.pickupEnabled = false
      }
    }
    onSave(next)
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3><IconSettings size={17} /> Configurações operacionais</h3>

        <h4>Base aérea (GOA/CBMBA)</h4>
        <div className="cfg-grid">
          <div className="field" style={{ gridColumn: 'span 2' }}>
            <label>Nome</label>
            <input type="text" value={c.base.name} onChange={(e) => set('base.name', e.target.value)} />
          </div>
          <Num label="Latitude" step={0.0001} value={c.base.lat} onChange={(v) => { setC((prev) => ({ ...prev, base: { ...prev.base, lat: v, verified: true } })) }} />
          <Num label="Longitude" step={0.0001} value={c.base.lon} onChange={(v) => { setC((prev) => ({ ...prev, base: { ...prev.base, lon: v, verified: true } })) }} />
        </div>
        <div className="small">Dica: você também pode <b>arrastar o marcador do helicóptero no mapa</b> até a posição exata da base.</div>

        <h4>Aeronave</h4>
        <div className="cfg-grid">
          <div className="field">
            <label>Modelo</label>
            <input type="text" value={c.aircraft.model} onChange={(e) => set('aircraft.model', e.target.value)} />
          </div>
          <Num label="Cruzeiro" suffix="km/h" value={c.aircraft.cruiseKmh} onChange={(v) => set('aircraft.cruiseKmh', v)} />
          <Num label="Fator de rota" step={0.01} value={c.aircraft.routeFactor} onChange={(v) => set('aircraft.routeFactor', v)} />
          <Num label="Alcance útil" suffix="km" value={c.aircraft.rangeKm} onChange={(v) => set('aircraft.rangeKm', v)} />
        </div>

        <h4>Tempos fixos (min)</h4>
        <div className="cfg-grid">
          <Num label="Acionamento → decolagem" value={c.times.acionamentoMin} onChange={(v) => set('times.acionamentoMin', v)} />
          <Num label="Pouso + embarque na cena" value={c.times.embarqueMin} onChange={(v) => set('times.embarqueMin', v)} />
          <Num label="Desembarque (heliponto)" value={c.times.desembarqueMin} onChange={(v) => set('times.desembarqueMin', v)} />
          <Num label="Transbordo (apoio/LZ)" value={c.times.transbordoMin} onChange={(v) => set('times.transbordoMin', v)} />
          <Num label="Atendimento na cena (terrestre)" value={c.times.cenaMin} onChange={(v) => set('times.cenaMin', v)} />
          <Num label="Parada p/ embarcar equipe" value={c.times.pickupStopMin} onChange={(v) => set('times.pickupStopMin', v)} />
        </div>

        <h4>Operação</h4>
        <div className="cfg-grid">
          <Num label="Fator trânsito (terrestre)" step={0.05} value={c.ground.trafficFactor} onChange={(v) => set('ground.trafficFactor', v)} />
          <Num label="Margem antes do pôr do sol" suffix="min" value={c.ops.sunsetMarginMin} onChange={(v) => set('ops.sunsetMarginMin', v)} />
          <Num label="Raio de busca de LZ" suffix="m" value={c.ops.lzRadiusM} onChange={(v) => set('ops.lzRadiusM', v)} />
        </div>
        <label className="chk" style={{ display: 'flex' }}>
          <input type="checkbox" checked={c.ops.nightAllowed} onChange={(e) => set('ops.nightAllowed', e.target.checked)} />
          <div>Operação noturna habilitada</div>
        </label>
        <label className="chk" style={{ display: 'flex' }}>
          <input type="checkbox" checked={c.ops.pickupEnabled} onChange={(e) => set('ops.pickupEnabled', e.target.checked)} />
          <div>Embarcar equipe SAMU em heliponto intermediário antes da cena</div>
        </label>
        {c.ops.pickupEnabled && (
          <div className="field">
            <label>Heliponto de embarque da equipe</label>
            <select value={c.ops.pickupHospitalId} onChange={(e) => set('ops.pickupHospitalId', e.target.value)}>
              {c.hospitals.filter((h) => h.heliponto).map((h) => (
                <option key={h.id} value={h.id}>{h.name}</option>
              ))}
            </select>
          </div>
        )}

        <h4>Mapa</h4>
        <div className="field">
          <label>Chave Google Maps JS API (opcional — habilita Satélite/Híbrido do Google)</label>
          <input
            type="text"
            value={c.map?.googleKey || ''}
            placeholder="AIza… (sem chave, o satélite usa Esri/Maxar)"
            onChange={(e) => setC((prev) => ({ ...prev, map: { ...(prev.map || {}), googleKey: e.target.value.trim() } }))}
          />
          <div className="small">
            Crie em console.cloud.google.com → APIs e serviços → Credenciais, habilite <b>Maps JavaScript API</b> e restrinja a chave ao domínio goa.mnrs.com.br.
            Nível gratuito: 10 mil carregamentos/mês. A chave fica salva só neste navegador.
          </div>
        </div>

        <h4>Hospitais de referência</h4>
        <div className="small" style={{ marginBottom: 8 }}>
          Confirme as posições com “buscar” (endereço) ou digitando lat/lon.
          Marque <b>Heli</b> se o hospital tem heliponto próprio operacional; senão, associe um <b>heliponto de apoio</b> para o desembarque.
        </div>
        <div className="hosp-row" style={{ marginBottom: 2 }}>
          <span className="small">Nome</span><span className="small">Lat</span><span className="small">Lon</span>
          <span className="small">Heli</span><span className="small">Heliponto de apoio</span><span /><span />
        </div>
        {c.hospitals.map((h, i) => (
          <div className="hosp-row" key={h.id}>
            <input type="text" value={h.name} onChange={(e) => setHosp(i, 'name', e.target.value)} />
            <NumInput step="0.0001" value={h.lat} onChange={(v) => setHosp(i, 'lat', v)} />
            <NumInput step="0.0001" value={h.lon} onChange={(v) => setHosp(i, 'lon', v)} />
            <label style={{ fontSize: 12 }}>
              <input type="checkbox" checked={!!h.heliponto} onChange={(e) => setHosp(i, 'heliponto', e.target.checked)} />
            </label>
            <select
              value={h.helipadIds?.[0] || ''}
              disabled={!!h.heliponto}
              onChange={(e) => setHosp(i, 'helipadIds', e.target.value ? [e.target.value, ...(h.helipadIds || []).filter((x) => x !== e.target.value)] : [])}
              title="Heliponto padrão de desembarque quando não há heliponto próprio"
            >
              <option value="">— (LZ + transbordo)</option>
              {(c.helipads || []).map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <button
              className="btn xs sec"
              disabled={busyGeo === h.id}
              onClick={() => geocodeInto(h.addr || h.name, (r) => { setHosp(i, 'lat', r.lat); setHosp(i, 'lon', r.lon); setHosp(i, 'verified', true) }, h.id)}
            >
              {busyGeo === h.id ? '…' : <><IconSearch size={11} /> buscar</>}
            </button>
            <button className="btn xs warn" onClick={() => set('hospitals', c.hospitals.filter((_, j) => j !== i))}><IconX size={11} /></button>
          </div>
        ))}
        <button
          className="btn xs ghost"
          onClick={() =>
            set('hospitals', [...c.hospitals, { id: 'h' + Date.now(), name: 'Novo hospital', tags: [], lat: c.base.lat, lon: c.base.lon, heliponto: false, helipadIds: [], verified: false }])
          }
        >
          + adicionar hospital
        </button>
        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          <input
            type="text"
            style={{ flex: 1 }}
            placeholder="ou cole um link do Google Maps (Compartilhar) / lat, lon"
            value={mapsLink}
            onChange={(e) => setMapsLink(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addFromMaps() }}
          />
          <button className="btn xs sec" disabled={busyGeo === 'maps' || !mapsLink.trim()} onClick={addFromMaps}>
            {busyGeo === 'maps' ? '…' : <><IconSearch size={11} /> adicionar do Maps</>}
          </button>
        </div>
        <div className="small" style={{ marginTop: 6 }}>
          Perfis disponíveis: {Object.values(TAG_LABELS).join(', ')} (edite os perfis no código ou peça na próxima versão).
        </div>

        <h4>Helipontos de apoio / rede privada</h4>
        <div className="small" style={{ marginBottom: 8 }}>
          Pontos de pouso fora dos hospitais de destino (ex.: IML Nina Rodrigues p/ o HGE) e helipontos da rede privada emprestáveis
          (Aliança, Cardio Pulmonar, Mater Dei). Posições ajustáveis por “buscar” ou lat/lon.
        </div>
        {(c.helipads || []).map((p, i) => (
          <div className="helipad-row" key={p.id}>
            <input type="text" value={p.name} onChange={(e) => setPad(i, 'name', e.target.value)} />
            <NumInput step="0.0001" value={p.lat} onChange={(v) => setPad(i, 'lat', v)} />
            <NumInput step="0.0001" value={p.lon} onChange={(v) => setPad(i, 'lon', v)} />
            <select value={p.kind || 'apoio'} onChange={(e) => setPad(i, 'kind', e.target.value)}>
              <option value="apoio">apoio</option>
              <option value="privado">rede privada</option>
            </select>
            <button
              className="btn xs sec"
              disabled={busyGeo === p.id}
              onClick={() => geocodeInto(p.addr || p.name, (r) => { setPad(i, 'lat', r.lat); setPad(i, 'lon', r.lon); setPad(i, 'verified', true) }, p.id)}
            >
              {busyGeo === p.id ? '…' : <><IconSearch size={11} /> buscar</>}
            </button>
            <button className="btn xs warn" onClick={() => removePad(p.id)}><IconX size={11} /></button>
          </div>
        ))}
        <button
          className="btn xs ghost"
          onClick={() => set('helipads', [...(c.helipads || []), { id: 'p' + Date.now(), name: 'Novo heliponto', kind: 'apoio', lat: c.base.lat, lon: c.base.lon, verified: false }])}
        >
          + adicionar heliponto
        </button>

        <h4>Bases de ambulância (SAMU 192)</h4>
        <div className="small" style={{ marginBottom: 8 }}>
          Bases SAMU de Salvador já vêm carregadas com as coordenadas de produção. O sistema calcula a rota base → cena
          das 3 mais próximas e usa a melhor como ETA da ambulância (dá para sobrescrever digitando o ETA no caso).
        </div>
        {(c.ambBases || []).map((b, i) => (
          <div className="helipad-row ambbase-row" key={b.id}>
            <input type="text" value={b.name} onChange={(e) => setC((prev) => ({ ...prev, ambBases: prev.ambBases.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) }))} />
            <NumInput step="0.0001" value={b.lat} onChange={(v) => setC((prev) => ({ ...prev, ambBases: prev.ambBases.map((x, j) => (j === i ? { ...x, lat: v } : x)) }))} />
            <NumInput step="0.0001" value={b.lon} onChange={(v) => setC((prev) => ({ ...prev, ambBases: prev.ambBases.map((x, j) => (j === i ? { ...x, lon: v } : x)) }))} />
            <button
              className="btn xs sec"
              disabled={busyGeo === b.id}
              onClick={() => geocodeInto(b.name + ', Salvador, BA', (r) => { const l = c.ambBases.slice(); l[i] = { ...b, lat: r.lat, lon: r.lon }; set('ambBases', l) }, b.id)}
            >
              {busyGeo === b.id ? '…' : <><IconSearch size={11} /> buscar</>}
            </button>
            <button className="btn xs warn" onClick={() => set('ambBases', c.ambBases.filter((_, j) => j !== i))}><IconX size={11} /></button>
          </div>
        ))}
        <button className="btn xs ghost" onClick={() => set('ambBases', [...(c.ambBases || []), { id: 'b' + Date.now(), name: 'Base SAMU', lat: -12.97, lon: -38.5 }])}>
          + adicionar base
        </button>

        <div className="row" style={{ marginTop: 20, justifyContent: 'flex-end' }}>
          <button className="btn sec" onClick={() => setC(JSON.parse(JSON.stringify(DEFAULTS)))}>Restaurar padrão</button>
          <button className="btn sec" onClick={onClose}>Cancelar</button>
          <button className="btn" onClick={sanitizeAndSave}>Salvar</button>
        </div>
      </div>
    </div>
  )
}
