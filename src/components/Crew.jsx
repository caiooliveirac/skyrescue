import { useState } from 'react'
import { api } from '../lib/backend.js'
import { CREW_SLOTS, CREW_KINDS, slotNome, crewFilled } from '../lib/crew.js'
import { fmtClock } from '../lib/geo.js'
import { IconHeli, IconUsers, IconEdit, IconX, IconCopy } from './Icons.jsx'

const achar = (roster, kind, nome) => {
  const n = String(nome || '').trim().toLowerCase()
  return n ? roster.find((r) => r.kind === kind && r.name.toLowerCase() === n) : null
}

// Aeronave e equipe DESTE voo. Cada posição escolhe do cadastro (sugestões ao
// digitar; o registro vem junto) ou aceita nome livre — quem ainda não está
// no cadastro entra com um toque no "+". `cobrar` = o acionamento já saiu e
// as posições obrigatórias passam a aparecer como pendência.
export function CrewCard({ crew, onChange, roster, onRosterAdd, onOpenRoster, prev, cobrar }) {
  const [salvando, setSalvando] = useState(null)
  const c = crew || {}
  const setSlot = (k, patch) => onChange({ ...c, [k]: { ...(c[k] || {}), ...patch } })
  const onNome = (slot, nome) => {
    // nome do cadastro: o registro vem junto; campo esvaziado leva o registro
    const m = achar(roster, slot.kind, nome)
    setSlot(slot.k, m ? { nome, reg: m.reg || '' } : nome.trim() ? { nome } : { nome: '', reg: '' })
  }
  const cadastrar = async (slot) => {
    setSalvando(slot.k)
    try { await onRosterAdd({ kind: slot.kind, name: slotNome(c, slot.k), reg: c[slot.k]?.reg || '' }) }
    catch (e) { alert('Falha ao cadastrar: ' + (e.message || e)) }
    finally { setSalvando(null) }
  }
  // o 2º operador só aparece quando há o 1º (a maioria dos voos tem um)
  const slots = CREW_SLOTS.filter((s) => s.k !== 'tripulante2' || slotNome(c, 'tripulante') || slotNome(c, 'tripulante2'))
  const vazio = !crewFilled(c)
  return (
    <div className="card" id="v-equipe">
      <h2>
        <IconHeli size={14} /> Aeronave e equipe
        <button className="btn xs ghost" style={{ marginLeft: 'auto' }} onClick={onOpenRoster} title="Cadastrar aeronaves, pilotos, operadores, médicos e enfermeiros">
          <IconUsers size={12} /> Cadastro
        </button>
      </h2>
      {vazio && prev && (
        <button className="btn xs" style={{ marginBottom: 10 }} onClick={() => onChange(prev.crew)}
          title="No mesmo plantão a equipe costuma ser a mesma">
          <IconCopy size={12} /> Mesma equipe do caso {prev.ref}{prev.at ? ` (${fmtClock(prev.at)})` : ''}
        </button>
      )}
      <div className="crew-grid">
        {slots.map((s) => {
          const nome = slotNome(c, s.k)
          const novo = nome && !achar(roster, s.kind, nome)
          return (
            <div key={s.k} className={'field' + (cobrar && s.req && !nome ? ' req-vazio' : '')}>
              <label>
                {s.label}{s.req && <span className="req-mark" title="cobrado na documentação depois do acionamento"> *</span>}
              </label>
              <div className="crew-inputs">
                <input type="text" list={'crew-' + s.kind} value={c[s.k]?.nome || ''} onChange={(e) => onNome(s, e.target.value)}
                  placeholder={roster.some((r) => r.kind === s.kind) ? 'digite ou escolha' : s.kind === 'aeronave' ? 'ex.: PP-ABC' : 'nome'} />
                <input type="text" className="crew-reg" value={c[s.k]?.reg || ''} onChange={(e) => setSlot(s.k, { reg: e.target.value })}
                  placeholder={s.reg} title={s.reg} />
                {novo && (
                  <button className="btn xs ghost" disabled={salvando === s.k} onClick={() => cadastrar(s)}
                    title="Guardar no cadastro para os próximos voos">{salvando === s.k ? '…' : '+ cadastro'}</button>
                )}
              </div>
            </div>
          )
        })}
      </div>
      <div className="field" style={{ marginBottom: 0 }}>
        <label>Outros a bordo (residente, observador, equipe SAMU embarcada…)</label>
        <input type="text" value={c.outros || ''} onChange={(e) => onChange({ ...c, outros: e.target.value })} />
      </div>
      {CREW_KINDS.map((k) => (
        <datalist key={k.kind} id={'crew-' + k.kind}>
          {roster.filter((r) => r.kind === k.kind).map((r) => <option key={r.id} value={r.name}>{r.reg || ''}</option>)}
        </datalist>
      ))}
      <div className="small" style={{ marginTop: 8 }}>
        Sai no PDF, no relatório para o GOA e no briefing do grupo. O cadastro é compartilhado pela equipe; o caso guarda uma cópia, então corrigir o cadastro depois não muda missões passadas.
      </div>
    </div>
  )
}

// Cadastro compartilhado (servidor): aeronaves, pilotos, operadores
// aerotáticos, médicos e enfermeiros. Qualquer login cadastra e corrige.
const EMPTY = { kind: 'piloto', name: '', reg: '' }

export function CrewRosterModal({ roster, onChanged, onClose }) {
  const [form, setForm] = useState(EMPTY)
  const [editing, setEditing] = useState(null) // id em edição (null = novo)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const meta = CREW_KINDS.find((k) => k.kind === form.kind) || CREW_KINDS[0]

  const submit = async (e) => {
    e.preventDefault(); setErr(''); setBusy(true)
    try {
      if (editing) await api.updateCrew(editing, form)
      else await api.createCrew(form)
      setForm({ ...EMPTY, kind: form.kind }); setEditing(null); await onChanged()
    } catch (e2) { setErr(e2.message) } finally { setBusy(false) }
  }
  const remove = async (m) => {
    if (!confirm(`Tirar ${m.name} do cadastro? (casos já registrados não mudam)`)) return
    try { await api.deleteCrew(m.id); await onChanged() } catch (e) { setErr(e.message) }
  }
  const field = (k) => ({ value: form[k], onChange: (e) => setForm({ ...form, [k]: e.target.value }) })

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3><IconUsers size={17} /> Cadastro de aeronaves e equipe</h3>
        <div className="small" style={{ marginBottom: 10 }}>
          Lista compartilhada de onde o card <b>Aeronave e equipe</b> de cada caso escolhe — o registro (CANAC, CRM, COREN…) vem junto com o nome.
          Sem dado de paciente aqui.
        </div>
        {err && <div className="login-err">{err}</div>}
        {CREW_KINDS.map((k) => {
          const lista = roster.filter((r) => r.kind === k.kind)
          return (
            <div key={k.kind} style={{ marginBottom: 8 }}>
              <div className="groupname">{k.label}</div>
              {!lista.length && <div className="small">Ninguém cadastrado.</div>}
              {lista.map((m) => (
                <div key={m.id} className="crew-roster-row">
                  <span style={{ flex: 1 }}><b>{m.name}</b>{m.reg ? <span className="small"> · {m.reg}</span> : null}</span>
                  <button className="btn xs sec" title="Editar" onClick={() => { setEditing(m.id); setForm({ kind: m.kind, name: m.name, reg: m.reg || '' }) }}><IconEdit size={12} /></button>
                  <button className="btn xs warn" title="Tirar do cadastro" onClick={() => remove(m)}><IconX size={12} /></button>
                </div>
              ))}
            </div>
          )
        })}
        <form className="contacts-form" onSubmit={submit}>
          <h4>{editing ? 'Editar cadastro' : 'Novo cadastro'}</h4>
          <select {...field('kind')}>
            {CREW_KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.one}</option>)}
          </select>
          <input type="text" placeholder={meta.name} required {...field('name')} />
          <input type="text" placeholder={`${meta.reg} (opcional)`} {...field('reg')} />
          <div>
            <button className="btn xs" type="submit" disabled={busy}>{editing ? 'Salvar' : 'Cadastrar'}</button>
            {editing && <button className="btn xs sec" type="button" onClick={() => { setEditing(null); setForm(EMPTY) }}>Cancelar</button>}
            <button className="btn xs sec" type="button" onClick={onClose} style={{ marginLeft: 'auto' }}>Fechar</button>
          </div>
        </form>
      </div>
    </div>
  )
}
