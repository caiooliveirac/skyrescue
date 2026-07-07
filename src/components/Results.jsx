import { useState } from 'react'
import { fmtMin, fmtKm } from '../lib/geo.js'
import { classifyWeather, WMO_LABEL } from '../lib/mission.js'
import { walkMin, LZ_FILTERS } from '../lib/lz.js'
import { IconHeli, IconAmbulance, IconCopy, IconPin, IconAlert, IconTarget, LZ_TYPE_ICON, IconHelipadH } from './Icons.jsx'

const MAX_SCORE = 18

const BAND_RING = { green: 'var(--ok)', yellow: 'var(--warn)', red: 'var(--fail)' }

// Faixa sticky com score, recomendação e estado dos gates — sempre visível.
export function DecisionStrip({ scene, score, gates, rec, onCopy }) {
  const pct = Math.min(score.total, MAX_SCORE) / MAX_SCORE * 100
  const ring = rec && rec.key === 'blocked' ? 'var(--fail)' : BAND_RING[score.band.key] || 'var(--faint)'
  return (
    <div className="decision">
      <div className="decision-inner">
        <div className="score-ring" style={{ '--pct': pct, '--ring': ring }}>
          {score.total}<small>PTS</small>
        </div>
        {scene && rec ? (
          <div className="decision-main">
            <div className={'decision-title ' + rec.key}>{rec.title}</div>
            <div className="decision-sub">{rec.detail}</div>
          </div>
        ) : (
          <div className="decision-main decision-empty">
            <IconPin size={16} />
            Marque o local da ocorrência (busca ou clique no mapa) e pontue o checklist para ver a recomendação.
          </div>
        )}
        <div className="gates-chips">
          {gates.rows.map((g) => (
            <span key={g.id} className={'gchip ' + (g.effective === 'unknown' ? '' : g.effective)} title={`${g.label}: ${g.effective.toUpperCase()}`}>
              <i /> {g.short || g.label}
            </span>
          ))}
        </div>
        {scene && (
          <button className="btn sec xs" onClick={onCopy}><IconCopy size={13} /> Resumo</button>
        )}
      </div>
    </div>
  )
}

export function TimePanel({ mission }) {
  if (!mission) return <div className="small">Defina o local da ocorrência para calcular os tempos.</div>
  const air = mission.airTotal
  const gnd = mission.ground.total
  const max = Math.max(air || 0, gnd || 0, 1)
  const airSegs = mission.legs.filter((l) => l.min != null)
  const cls = ['p1', 'p2', 'p3', 'p4', 'p5', 'p1', 'p2']
  return (
    <div>
      <div className="tbar air">
        <div className="lab">
          <span className="who"><IconHeli size={15} /> Aeromédico</span>
          <span className="val">{fmtMin(air)}</span>
        </div>
        <div className="bar">
          {air != null && airSegs.map((l, i) => (
            <div key={l.k + i} className={'p ' + cls[i % cls.length]} style={{ width: `${(l.min / max) * 100}%` }} title={`${l.label}: ${fmtMin(l.min)}`} />
          ))}
        </div>
      </div>
      <div className="tbar gnd">
        <div className="lab">
          <span className="who"><IconAmbulance size={15} /> Terrestre</span>
          <span className="val">{gnd != null ? fmtMin(gnd) : mission.ground.partial != null ? `≥ ${fmtMin(mission.ground.partial)}` : '—'}</span>
        </div>
        <div className="bar">
          {mission.ground.etaMin != null && <div className="p p1" style={{ width: `${(mission.ground.etaMin / max) * 100}%` }} title={`Ambulância → cena: ${fmtMin(mission.ground.etaMin)}`} />}
          {gnd != null && <div className="p p2" style={{ width: `${(mission.ground.cenaMin / max) * 100}%` }} title={`Atendimento na cena: ${fmtMin(mission.ground.cenaMin)}`} />}
          {mission.ground.toHospMin != null && <div className="p p3" style={{ width: `${(mission.ground.toHospMin / max) * 100}%` }} title={`Cena → hospital: ${fmtMin(mission.ground.toHospMin)}`} />}
        </div>
        {gnd == null && mission.ground.partial != null && (
          <div className="small" style={{ marginTop: 3 }}>sem ETA da ambulância — informe em “Destino e operação”</div>
        )}
      </div>
      {mission.delta != null && (
        <div className={'delta-chip ' + (mission.delta > 0 ? 'pos' : 'neg')}>
          {mission.delta > 0
            ? <>▲ Aeronave chega ao destino ~{fmtMin(mission.delta)} antes</>
            : <>▼ Via terrestre é ~{fmtMin(-mission.delta)} mais rápida</>}
        </div>
      )}
      <table className="legtable">
        <tbody>
          {mission.legs.map((l, i) => (
            <tr key={i}>
              <td>{l.label}{l.km != null ? ` · ${fmtKm(l.km)}` : ''}</td>
              <td>{fmtMin(l.min)}</td>
            </tr>
          ))}
          <tr>
            <td>Rota terrestre cena → hospital {mission.ground.distKm != null ? `(${fmtKm(mission.ground.distKm)}, c/ fator trânsito)` : ''}</td>
            <td>{fmtMin(mission.ground.toHospMin)}</td>
          </tr>
        </tbody>
      </table>
      <div className="small" style={{ marginTop: 8 }}>
        Estimativas: voo em linha reta ×fator de rota; terrestre via OSRM <b>sem trânsito em tempo real</b> (fator ajustável em Config).
      </div>
    </div>
  )
}

function WxCard({ title, w, err }) {
  if (err) return <div className="wxcard"><div className="where">{title}</div><div className="small">Erro ao consultar ({String(err)})</div></div>
  if (!w) return <div className="wxcard"><div className="where">{title}</div><div className="small"><span className="spin" /> consultando…</div></div>
  const c = classifyWeather(w)
  const badge = c.level === 'ok' ? <span className="badge ok">FAVORÁVEL</span> : c.level === 'warn' ? <span className="badge warn">MARGINAL</span> : <span className="badge fail">DESFAVORÁVEL</span>
  return (
    <div className="wxcard">
      <div className="where">{title} {badge}</div>
      <div className="main">{WMO_LABEL[w.code] || `Código ${w.code}`}{w.temp != null ? ` · ${Math.round(w.temp)}°C` : ''}</div>
      <ul>
        <li>Vento {w.windKmh != null ? Math.round(w.windKmh) : '—'} km/h ({w.windKmh != null ? Math.round(w.windKmh / 1.852) : '—'} kt) · rajadas {w.gustKmh != null ? Math.round(w.gustKmh) : '—'} km/h</li>
        <li>Visibilidade {w.visM != null ? (w.visM / 1000).toFixed(1) + ' km' : 'sem dado'} · nuvens {w.cloud != null ? w.cloud + '%' : '—'}</li>
        <li>Precipitação {w.precip != null ? w.precip + ' mm/h' : '—'}</li>
        {c.reasons.map((r, i) => <li key={i}>{r}</li>)}
      </ul>
    </div>
  )
}

export function WeatherPanel({ wxScene, wxBase, wxErr, metar, daylight }) {
  return (
    <div>
      <div className="wx">
        <WxCard title="Na cena" w={wxScene} err={wxErr} />
        <WxCard title="Na base" w={wxBase} />
      </div>
      {daylight && daylight.note && (
        <div className={'alert ' + (daylight.status === 'fail' ? 'fail' : daylight.status === 'warn' ? 'warn' : 'info')} style={{ marginTop: 10 }}>
          {daylight.note}
        </div>
      )}
      {metar && <div className="metar mono">METAR SBSV: {metar}</div>}
      <div className="small" style={{ marginTop: 8 }}>
        Meteorologia <b>indicativa</b> (Open-Meteo{metar ? ' + METAR' : ''}). Decisão final: comandante da aeronave com fontes oficiais (REDEMET).
      </div>
    </div>
  )
}

const SUIT_BADGE = {
  ideal: ['ok', 'Ideal'],
  boa: ['ok', 'Boa — ampla'],
  avaliar: ['warn', 'Avaliar dimensões'],
  restrita: ['fail', 'Restrita'],
}

export function LZPanel({ lz, lzErr, lzLoading, lzSelId, manualLz, onSelect, onFocus, onClearManual, onRetry, mode, setMode }) {
  const [filter, setFilter] = useState('all')
  const list = lz || []
  const counts = Object.fromEntries(LZ_FILTERS.map((f) => [f.key, f.key === 'all' ? list.length : list.filter((c) => c.typeKey === f.key).length]))
  // filtro herdado de outra cena sem correspondência cai para 'Todas'
  const active = counts[filter] > 0 ? filter : 'all'
  const shown = active === 'all' ? list : list.filter((c) => c.typeKey === active)
  return (
    <div>
      <div className="row" style={{ marginBottom: 8 }}>
        <button className={'btn xs ' + (mode === 'lz' ? '' : 'sec')} onClick={() => setMode(mode === 'lz' ? 'scene' : 'lz')}>
          <IconTarget size={13} /> {mode === 'lz' ? 'Clique no mapa para marcar a LZ…' : 'Definir LZ manual no mapa'}
        </button>
        {manualLz && <button className="btn xs sec" onClick={onClearManual}>Remover LZ manual</button>}
      </div>
      {lzLoading && <div className="small"><span className="spin" /> buscando áreas de pouso no OpenStreetMap…</div>}
      {lzErr && (
        <div className="alert warn">
          <IconAlert size={15} /> Não foi possível buscar áreas de pouso (serviço OSM ocupado). Defina LZ manual ou{' '}
          {onRetry && <button className="btn xs sec" onClick={onRetry} style={{ marginLeft: 4 }}>tentar de novo</button>}
        </div>
      )}
      {lz && !lz.length && <div className="alert warn"><IconAlert size={15} /> Nenhuma área candidata no raio configurado. Amplie o raio em Config ou defina LZ manual.</div>}

      {list.length > 0 && (
        <div className="lzfilters">
          {LZ_FILTERS.filter((f) => counts[f.key] > 0).map((f) => (
            <button key={f.key} className={'fchip' + (active === f.key ? ' on' : '')} onClick={() => setFilter(f.key)}>
              {f.label}<span className="cnt">{counts[f.key]}</span>
            </button>
          ))}
        </div>
      )}

      {shown.map((c) => {
        const Icon = LZ_TYPE_ICON[c.type] || IconHelipadH
        const suitCls = c.obstFlag && c.suitKey !== 'restrita' ? 'avaliar' : c.suitKey
        const [bcls, blabel] = SUIT_BADGE[c.suitKey] || ['', c.suit]
        const sel = c.id === lzSelId
        return (
          <div
            key={c.id}
            className={'lzrow' + (sel ? ' sel' : '')}
            onClick={() => { onSelect(c.id); onFocus && onFocus(c) }}
            title="Clique para usar esta área e centralizar no mapa"
          >
            <div className={'lztile suit-' + suitCls}>
              <Icon size={20} />
              <span className="letter">{c.letter}</span>
            </div>
            <div className="lzmain">
              <div className="n">
                {c.name} <span className="type">{c.type}</span>
                <span className={'badge ' + bcls}>{blabel}{c.dims ? ` · ~${c.dims.w}×${c.dims.h} m` : ''}</span>
              </div>
              <div className="m">
                {c.distM} m da ocorrência (~{walkMin(c.distM)} min a pé)
                {c.surface ? ` · piso: ${c.surface}` : ''}{c.lit ? ' · iluminada' : ''}
              </div>
              {(c.obstFlag || (c.obstNear != null && c.obstNear < 400)) && (
                <div className="ob"><IconAlert size={12} /> {c.obstWhat} a ~{c.obstNear} m{c.obstFlag ? ' — reconhecimento obrigatório' : ''}</div>
              )}
            </div>
            <button className={'btn xs ' + (sel ? '' : 'sec')} onClick={(e) => { e.stopPropagation(); onSelect(c.id); if (!sel && onFocus) onFocus(c) }}>
              {sel ? 'Selecionada ✓' : 'Usar'}
            </button>
          </div>
        )
      })}
      <div className="small" style={{ marginTop: 8 }}>
        Sugestões do OpenStreetMap — <b>reconhecimento visual pelo piloto é obrigatório</b> (fios, postes, pessoas, inclinação, obstáculos não mapeados).
      </div>
    </div>
  )
}

export function AlertsPanel({ alerts }) {
  if (!alerts.length) return <div className="small">Sem alertas no momento.</div>
  return (
    <div>
      {alerts.map((a, i) => (
        <div key={i} className={'alert ' + a.level}><IconAlert size={15} style={{ flex: 'none', marginTop: 1 }} /> {a.text}</div>
      ))}
    </div>
  )
}

export function GatesPanel({ gates, manualVals, onManual, onOverride }) {
  const st = (s) =>
    s === 'ok' ? <span className="badge ok">OK</span> :
    s === 'warn' ? <span className="badge warn">ATENÇÃO</span> :
    s === 'fail' ? <span className="badge fail">IMPEDITIVO</span> :
    <span className="badge">SEM DADO</span>
  return (
    <div>
      {gates.rows.map((g) => (
        <div className="gate" key={g.id}>
          <span className="glabel">{g.label}</span>
          {g.manual ? (
            <label className="switch row" style={{ gap: 6 }}>
              <input
                type="checkbox"
                checked={manualVals[g.id] !== false}
                onChange={(e) => onManual(g.id, e.target.checked)}
              />
              {st(manualVals[g.id] === false ? 'fail' : 'ok')}
            </label>
          ) : (
            <>
              {st(g.status)}
              <select value={g.override || 'auto'} onChange={(e) => onOverride(g.id, e.target.value === 'auto' ? null : e.target.value)}>
                <option value="auto">auto</option>
                <option value="ok">forçar OK</option>
                <option value="fail">forçar NÃO</option>
              </select>
            </>
          )}
        </div>
      ))}
      <div className="small" style={{ marginTop: 6 }}>
        Qualquer impeditivo torna o acionamento <b>inviável no momento</b>, independentemente do score.
      </div>
    </div>
  )
}
