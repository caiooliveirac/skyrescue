import { useEffect, useRef, useState } from 'react'
import { fmtClock } from '../lib/geo.js'
import { IconCheck } from './Icons.jsx'

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

// Marcação rápida em um toque: um único botão mostra sempre o PRÓXIMO marco
// da missão (a sequência é fixa) e registra com a hora do toque — pensado para
// o piloto no modo navegação e o médico no celular, sem procurar menu nenhum.
// Depois do toque vira uma confirmação com "desfazer" por alguns segundos.
export function MilestoneQuick({ events, onMark, onUndo, className = '' }) {
  const [undoInfo, setUndoInfo] = useState(null) // {id, label, ts}
  const timerRef = useRef(null)
  useEffect(() => () => clearTimeout(timerRef.current), [])

  const next = MILESTONES.find((m) => !events[m.id])
  if (undoInfo) {
    return (
      <div className={'qmark qdone ' + className}>
        <span className="qm-ok"><IconCheck size={15} /> {undoInfo.label} · <b>{toTimeStr(undoInfo.ts)}</b></span>
        <button onClick={() => {
          clearTimeout(timerRef.current)
          onUndo(undoInfo.id)
          setUndoInfo(null)
        }}>desfazer</button>
      </div>
    )
  }
  if (!next) return null
  const mark = () => {
    const ts = Date.now()
    onMark(next.id, ts)
    setUndoInfo({ id: next.id, label: next.label, ts })
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setUndoInfo(null), 6000)
  }
  return (
    <button className={'qmark ' + className} onClick={mark}>
      <span className="qm-act">marcar</span>
      <span className="qm-label">{next.label}</span>
    </button>
  )
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
