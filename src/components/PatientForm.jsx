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

export default function PatientForm({ patient, onChange, sync, soLocal, onEnviar, enviando }) {
  return (
    <div className="card">
      <h2>
        Ficha do paciente <span className="badge info">prontuário</span>
        {sync?.err && <span className="badge warn" title={sync.err}>sem gravar</span>}
      </h2>
      <div className="small" style={{ marginBottom: 10 }}>
        Preenchimento para o <b>prontuário exportável</b> (HTML → PDF, assinável no gov.br). A ficha é
        gravada <b>no servidor do GOA</b>, junto do caso: quem estiver acompanhando a ocorrência vê o que
        você acrescenta, e reabrir o caso em qualquer aparelho traz a ficha de volta. Contém dado
        identificável de paciente — o acesso é restrito à equipe autorizada e <b>fica registrado</b>.
        O documento definitivo continua sendo o PDF assinado e arquivado.
      </div>
      {soLocal && (
        <div className="notice" style={{ marginBottom: 10 }}>
          Esta ficha foi preenchida quando os dados ficavam <b>só neste navegador</b>, e por isso ainda
          não está no servidor — ninguém mais a enxerga.
          <div style={{ marginTop: 8 }}>
            <button className="btn xs" onClick={onEnviar} disabled={enviando}>
              {enviando ? 'enviando…' : 'Enviar esta ficha para o servidor'}
            </button>
          </div>
        </div>
      )}
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
