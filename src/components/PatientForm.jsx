import { PATIENT_SECTIONS, ageFrom } from '../lib/patient.js'

// Ficha do paciente na tela do médico logado. Mora no servidor, com espelho
// neste aparelho para funcionar sem rede (ver src/lib/patient.js e outbox.js).
function Field({ f, value, onChange }) {
  const common = { value: value || '', onChange: (e) => onChange(f.k, e.target.value) }
  return (
    <div className={'field' + (f.req && !String(value || '').trim() ? ' req-vazio' : '')} style={f.w === 2 ? { gridColumn: '1 / -1' } : undefined}>
      <label>
        {f.label}{f.req && <span className="req-mark" title="obrigatório para o caso ficar documentado"> *</span>}
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

export default function PatientForm({ patient, onChange, sync, soLocal, onEnviar, enviando, faltam = [], aviso = null }) {
  return (
    <div className="card" id="v-paciente">
      <h2>
        Ficha do paciente <span className="badge info">prontuário</span>
        {sync?.err && <span className="badge warn" title={sync.err}>sem gravar</span>}
      </h2>
      <div className="small" style={{ marginBottom: 10 }}>
        Preenchimento para o <b>prontuário exportável</b> (PDF assinável no gov.br). A ficha é
        gravada <b>no servidor do GOA</b>, junto do caso: quem estiver acompanhando a ocorrência vê o que
        você acrescenta, e reabrir o caso em qualquer aparelho traz a ficha de volta. Sem rede, o que
        você digita fica guardado neste aparelho e sobe sozinho depois. Contém dado
        identificável de paciente — o acesso é restrito à equipe autorizada e <b>fica registrado</b>.
        O documento definitivo continua sendo o PDF assinado e arquivado.
      </div>
      {aviso}
      {faltam.length > 0 ? (
        <div className="alert warn" style={{ marginBottom: 10 }}>
          <span><b>Faltam {faltam.length} campo{faltam.length > 1 ? 's' : ''} obrigatório{faltam.length > 1 ? 's' : ''}</b> (marcados com *):{' '}
            {faltam.map((f) => f.label).join(', ')}. Paciente sem identificação? Escreva "não identificado" no nome.</span>
        </div>
      ) : (
        <div className="alert ok" style={{ marginBottom: 10 }}>Campos obrigatórios da ficha preenchidos.</div>
      )}
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
