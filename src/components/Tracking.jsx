import { fmtClock } from '../lib/geo.js'

export const MILESTONES = [
  { id: 'decisao', label: 'Acionamento do GOA autorizado' },
  { id: 'decolagem', label: 'Decolagem da base' },
  { id: 'pouso_cena', label: 'Pouso na cena / LZ' },
  { id: 'paciente', label: 'Contato com o paciente' },
  { id: 'decolagem2', label: 'Decolagem para o destino' },
  { id: 'pouso_destino', label: 'Pouso no destino' },
  { id: 'entrega', label: 'Paciente entregue na unidade' },
  { id: 'livre', label: 'Aeronave liberada' },
]

function toTimeStr(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export default function Tracking({ events, onMark, onEdit, mission }) {
  const nextIdx = MILESTONES.findIndex((m) => !events[m.id])
  return (
    <div className="tl">
      {MILESTONES.map((m, i) => {
        const done = !!events[m.id]
        return (
          <div className={'tlrow' + (done ? ' done' : '') + (i === nextIdx ? ' next' : '')} key={m.id}>
            <div className="dot" />
            <div className="tlabel">{m.label}</div>
            {done ? (
              <>
                <input
                  type="time"
                  value={toTimeStr(events[m.id])}
                  onChange={(e) => onEdit(m.id, e.target.value)}
                />
              </>
            ) : (
              <button className={'btn xs' + (i === nextIdx ? '' : ' sec')} disabled={i !== nextIdx} onClick={() => onMark(m.id)}>
                marcar agora
              </button>
            )}
          </div>
        )
      })}
      {events.decisao && mission?.airTotal != null && (
        <div className="small" style={{ marginTop: 8 }}>
          Chegada prevista ao destino: <b>{fmtClock(new Date(events.decisao).getTime() + mission.airTotal * 60000)}</b>
          {events.pouso_destino && (
            <> · real: <b>{fmtClock(events.pouso_destino)}</b></>
          )}
        </div>
      )}
    </div>
  )
}
