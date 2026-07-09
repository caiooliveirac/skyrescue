import { useState } from 'react'
import { IconHeli } from './Icons.jsx'
import { api } from '../lib/backend.js'

// Portão de acesso: autentica no backend (/api/auth/login) — a sessão fica
// num cookie httpOnly. Sem persistir credenciais no cliente.
export default function Login({ onAuth }) {
  const [user, setUser] = useState('')
  const [pass, setPass] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    if (busy) return
    setBusy(true); setErr('')
    try {
      const { user: u } = await api.login(user.trim(), pass)
      onAuth(u)
    } catch (ex) {
      setErr(ex.status === 401 ? 'Usuário ou senha incorretos.'
        : 'Falha ao conectar ao servidor. Tente novamente.')
      setBusy(false)
    }
  }

  return (
    <div className="login-bg">
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand">
          <div className="logo-mark"><IconHeli size={24} /></div>
          <div>
            <div className="logo-word">SkyRescue<span className="beta">BETA</span></div>
            <div className="sub">Apoio à decisão aeromédica · SAMU 192 Salvador × GOA/CBMBA</div>
          </div>
        </div>

        <div className="login-title">Acesso restrito</div>

        <div className="field">
          <label>Usuário</label>
          <input
            type="text"
            autoFocus
            autoComplete="username"
            value={user}
            onChange={(e) => { setUser(e.target.value); setErr('') }}
            placeholder="usuário"
          />
        </div>

        <div className="field">
          <label>Senha</label>
          <input
            type="password"
            autoComplete="current-password"
            value={pass}
            onChange={(e) => { setPass(e.target.value); setErr('') }}
            placeholder="senha"
          />
        </div>

        {err && <div className="login-err">{err}</div>}

        <button className="btn" type="submit" disabled={busy}
          style={{ width: '100%', justifyContent: 'center', marginTop: 4 }}>
          {busy ? <span className="spin" /> : 'Entrar'}
        </button>

        <div className="small" style={{ marginTop: 12, textAlign: 'center' }}>
          Ferramenta em fase piloto — uso restrito à equipe autorizada.
        </div>
      </form>
    </div>
  )
}
