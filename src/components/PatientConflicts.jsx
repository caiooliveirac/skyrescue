import { useEffect, useState } from 'react'
import { api } from '../lib/backend.js'
import { PATIENT_SECTIONS } from '../lib/patient.js'

const ROTULO = Object.fromEntries(PATIENT_SECTIONS.flatMap((s) => s.fields.map((f) => [f.k, f.label])))
const quando = (t) => (t ? new Date(t).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '')

// Divergências do prontuário: o mesmo campo foi alterado no servidor e num
// aparelho que estava sem rede. Nenhum dos dois valores foi descartado — o
// campo segue com o valor do servidor até alguém da equipe escolher aqui.
// A escolha fica registrada (quem, quando, qual).
export default function PatientConflicts({ caseId, count, onResolved }) {
  const [lista, setLista] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(null)

  const carregar = () => api.patientConflicts(caseId)
    .then((r) => { setLista(r.conflicts); setErr('') })
    .catch((e) => setErr(e.message || String(e)))
  useEffect(() => { if (count > 0) carregar(); else setLista(null) }, [caseId, count])

  if (!count) return null

  const resolver = async (c, chosen) => {
    setBusy(c.id)
    try {
      const r = await api.resolveConflict(caseId, c.id, chosen)
      setLista((l) => (l || []).filter((x) => x.id !== c.id))
      onResolved?.(r.pendingConflicts)
    } catch (e) {
      setErr(e.message || String(e))
      carregar()
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="alert warn conflitos" style={{ marginBottom: 10 }}>
      <div style={{ width: '100%' }}>
        <b>{count} divergência{count > 1 ? 's' : ''} no prontuário.</b>{' '}
        O mesmo campo foi alterado aqui no servidor e em um aparelho que estava sem rede.
        Nada foi apagado: escolha qual valor fica.
        {err && <div className="small" style={{ marginTop: 6 }}>Falha: {err}</div>}
        {(lista || []).map((c) => (
          <div className="conflito" key={c.id}>
            <div className="groupname">{ROTULO[c.field] || c.field}</div>
            <div className="lados">
              <div className="lado">
                <div className="small">No servidor{c.serverBy ? ` · ${c.serverBy}` : ''}{c.serverAt ? ` · ${quando(c.serverAt)}` : ''}</div>
                <div className="valor">{c.serverValue || <i>(vazio)</i>}</div>
                <button className="btn xs sec" disabled={busy === c.id} onClick={() => resolver(c, 'server')}>Manter este</button>
              </div>
              <div className="lado">
                <div className="small">Do aparelho{c.clientBy ? ` · ${c.clientBy}` : ''}{c.clientAt ? ` · ${quando(c.clientAt)}` : ''}</div>
                <div className="valor">{c.clientValue || <i>(vazio)</i>}</div>
                <button className="btn xs sec" disabled={busy === c.id} onClick={() => resolver(c, 'client')}>Usar este</button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
