import { PATIENT_SECTIONS, ageFrom } from '../lib/patient.js'

// Ficha do paciente na tela do médico logado. Os dados ficam SÓ no
// navegador (ver src/lib/patient.js) e alimentam o prontuário exportável.
function Field({ f, value, onChange }) {
  const common = { value: value || '', onChange: (e) => onChange(f.k, e.target.value) }
  return (
    <div className="field" style={f.w === 2 ? { gridColumn: '1 / -1' } : undefined}>
      <label>
        {f.label}
        {f.k === 'nascimento' && ageFrom(value) && <span className="auto-tag" style={{ fontStyle: 'normal' }}> {ageFrom(value)}</span>}
      </label>
      {f.type === 'textarea' ? (
        <textarea rows={2} {...common} />
      ) : f.type === 'select' ? (
        <select {...common}>
          {f.opts.map((o) => <option key={o} value={o}>{o || '—'}</option>)}
        </select>
      ) : (
        <input type={f.type === 'date' ? 'date' : 'text'} {...common} />
      )}
    </div>
  )
}

export default function PatientForm({ patient, onChange }) {
  return (
    <div className="card">
      <h2>
        Ficha do paciente <span className="badge info">prontuário</span>
      </h2>
      <div className="small" style={{ marginBottom: 10 }}>
        Preenchimento para o <b>prontuário exportável</b> (HTML → PDF, assinável no gov.br). Estes dados
        ficam <b>só neste navegador</b> e <b>não vão para o servidor</b> — não são gravados no caso.
      </div>
      {PATIENT_SECTIONS.map((s) => (
        <div key={s.id} style={{ marginBottom: 6 }}>
          <div className="groupname">{s.title}</div>
          <div className="pfgrid">
            {s.fields.map((f) => (
              <Field key={f.k} f={f} value={patient[f.k]} onChange={onChange} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
