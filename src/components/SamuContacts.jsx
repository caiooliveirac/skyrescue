import { useEffect, useState } from 'react'
import { api } from '../lib/backend.js'
import { IconAmbulance, IconCopy, IconCheck, IconX, IconEdit } from './Icons.jsx'

// Agenda de acionamento das centrais SAMU: qualquer login consulta (ordem
// alfabética, copiar telefone com um toque); admin/gestor cadastram e editam.
const EMPTY = { samu: '', person: '', phone: '' }

export default function SamuContactsModal({ user, onClose }) {
  const canEdit = user?.role === 'admin' || user?.role === 'gestor'
  const [list, setList] = useState([])
  const [err, setErr] = useState('')
  const [form, setForm] = useState(EMPTY)
  const [editing, setEditing] = useState(null) // id em edição (null = novo)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(null)

  const load = () => api.listSamuContacts().then((r) => setList(r.contacts)).catch((e) => setErr(e.message))
  useEffect(() => { load() }, [])

  const copy = async (c) => {
    try { await navigator.clipboard.writeText(c.phone) } catch (e) { /* sem clipboard (http) */ }
    setCopied(c.id); setTimeout(() => setCopied(null), 1500)
  }

  const submit = async (e) => {
    e.preventDefault(); setErr(''); setBusy(true)
    try {
      if (editing) await api.updateSamuContact(editing, form)
      else await api.createSamuContact(form)
      setForm(EMPTY); setEditing(null); await load()
    } catch (e2) { setErr(e2.message) } finally { setBusy(false) }
  }

  const remove = async (c) => {
    if (!confirm(`Excluir o contato de ${c.samu}?`)) return
    try { await api.deleteSamuContact(c.id); await load() } catch (e) { setErr(e.message) }
  }

  const field = (k) => ({ value: form[k], onChange: (e) => setForm({ ...form, [k]: e.target.value }) })

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3><IconAmbulance size={17} /> Contatos das centrais SAMU</h3>
        {err && <div className="login-err">{err}</div>}
        {!list.length && <div className="small">Nenhum contato cadastrado ainda.</div>}
        {list.length > 0 && (
          <table className="contacts">
            <thead><tr><th>SAMU</th><th>Contato</th><th>Telefone</th></tr></thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.id}>
                  <td>{c.samu}</td>
                  <td>{c.person || '—'}</td>
                  <td>
                    <a href={`tel:${c.phone.replace(/[^\d+]/g, '')}`}>{c.phone}</a>
                    <button className="btn xs sec" onClick={() => copy(c)} title="Copiar telefone">
                      {copied === c.id ? <><IconCheck size={12} /> copiado</> : <IconCopy size={12} />}
                    </button>
                    {canEdit && <>
                      <button className="btn xs sec" onClick={() => { setEditing(c.id); setForm({ samu: c.samu, person: c.person || '', phone: c.phone }) }} title="Editar"><IconEdit size={12} /></button>
                      <button className="btn xs warn" onClick={() => remove(c)} title="Excluir"><IconX size={12} /></button>
                    </>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {canEdit && (
          <form className="contacts-form" onSubmit={submit}>
            <h4>{editing ? 'Editar contato' : 'Novo contato'}</h4>
            <input type="text" placeholder="SAMU (ex.: SAMU Feira de Santana)" required {...field('samu')} />
            <input type="text" placeholder="Nome de quem atende" {...field('person')} />
            <input type="tel" placeholder="Telefone" required {...field('phone')} />
            <div>
              <button className="btn xs" type="submit" disabled={busy}>{editing ? 'Salvar' : 'Cadastrar'}</button>
              {editing && <button className="btn xs sec" type="button" onClick={() => { setEditing(null); setForm(EMPTY) }}>Cancelar</button>}
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
