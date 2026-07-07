import { SECTIONS } from '../lib/score.js'

function Item({ it, effective, overridden, onToggle, onReset }) {
  return (
    <div className={'chk' + (effective ? ' checked' : '')} onClick={() => onToggle(it.id)}>
      <input type="checkbox" checked={!!effective} readOnly />
      <div>
        {it.label}{' '}
        {it.auto && <span className="auto-tag">AUTO</span>}{' '}
        {it.auto && overridden && (
          <button className="reset" onClick={(e) => { e.stopPropagation(); onReset(it.id) }}>
            voltar ao automático
          </button>
        )}
      </div>
      <span className="pts">+{it.pts}</span>
    </div>
  )
}

export default function Checklist({ isChecked, isOverridden, onToggle, onReset, score }) {
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
            {s.items &&
              s.items.map((it) => (
                <Item key={it.id} it={it} effective={isChecked(it.id)} overridden={isOverridden(it.id)} onToggle={onToggle} onReset={onReset} />
              ))}
            {s.groups &&
              s.groups.map((g) => (
                <div key={g.name}>
                  <div className="groupname">{g.name}</div>
                  {g.items.map((it) => (
                    <Item key={it.id} it={it} effective={isChecked(it.id)} overridden={isOverridden(it.id)} onToggle={onToggle} onReset={onReset} />
                  ))}
                </div>
              ))}
          </div>
        )
      })}
    </div>
  )
}
