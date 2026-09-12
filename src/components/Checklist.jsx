import { SECTIONS } from '../lib/score.js'

function Item({ it, effective, overridden, onToggle, onReset, text, onText }) {
  return (
    <div className={'chk' + (effective ? ' checked' : '')} onClick={() => onToggle(it.id)}>
      <input type="checkbox" checked={!!effective} readOnly />
      <div style={{ flex: 1 }}>
        {it.label}{' '}
        {it.auto && <span className="auto-tag">AUTO</span>}{' '}
        {it.auto && overridden && (
          <button className="reset" onClick={(e) => { e.stopPropagation(); onReset(it.id) }}>
            voltar ao automático
          </button>
        )}
        {it.text && effective && (
          <input
            type="text" value={text || ''} placeholder="qual? (ex.: hemoptise maciça)"
            onClick={(e) => e.stopPropagation()} onChange={(e) => onText(it.id, e.target.value)}
            style={{ display: 'block', width: '100%', marginTop: 5, padding: '4px 8px', fontSize: 13 }}
          />
        )}
      </div>
      <span className="pts">+{it.pts}</span>
    </div>
  )
}

export default function Checklist({ isChecked, isOverridden, onToggle, onReset, score, texts = {}, onText }) {
  const item = (it) => (
    <Item key={it.id} it={it} effective={isChecked(it.id)} overridden={isOverridden(it.id)}
      onToggle={onToggle} onReset={onReset} text={texts[it.id]} onText={onText} />
  )
  return (
    <div>
      {SECTIONS.map((s) => {
        const sec = score.perSection[s.id]
        return (
          <div className="card" key={s.id} style={{ marginBottom: 14 }}>
            <h2>
              {s.title}
              <span className={'badge ' + (sec.capped > 0 ? 'info' : '')}>
                {sec.capped}{s.cap != null ? `/${s.cap}` : ''} pts
              </span>
            </h2>
            {s.capNote && <div className="small" style={{ marginTop: -6, marginBottom: 6 }}>{s.capNote}</div>}
            {s.items && s.items.map(item)}
            {s.groups &&
              s.groups.map((g) => (
                <div key={g.name}>
                  <div className="groupname">{g.name}</div>
                  {g.items.map(item)}
                </div>
              ))}
          </div>
        )
      })}
    </div>
  )
}
