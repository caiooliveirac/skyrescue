import React, { useState, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import Login from './components/Login.jsx'
import Acionamento from './components/Acionamento.jsx'
import { api } from './lib/backend.js'
import './styles.css'

// Último usuário autenticado neste aparelho. Sem rede o app abre com ele —
// só para trabalhar no que já está guardado aqui; nada sobe antes de
// /api/auth/me confirmar a sessão (lib/outbox.js). Só identificação (nome,
// perfil), nenhuma credencial. Some no logout e quando o servidor diz 401.
const LAST_USER = 'skyrescue_last_user_v1'
const lembrar = (u) => { try { localStorage.setItem(LAST_USER, JSON.stringify(u)) } catch (e) { /* ok */ } }
const esquecer = () => { try { localStorage.removeItem(LAST_USER) } catch (e) { /* ok */ } }
const lembrado = () => { try { return JSON.parse(localStorage.getItem(LAST_USER)) } catch (e) { return null } }

// App abre sem rede: o service worker guarda a casca (public/sw.js). Só em
// http(s) — o bundle também roda aberto do disco (file://).
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('/sw.js').catch((e) => console.warn('service worker:', e?.message || e))
}

function Root() {
  const [state, setState] = useState('checking') // 'checking' | 'in' | 'out' | 'login'
  const [user, setUser] = useState(null)

  useEffect(() => {
    api.me()
      .then(({ user }) => { lembrar(user); setUser(user); setState('in') })
      .catch((e) => {
        // 401 é o servidor dizendo que não há sessão. Qualquer outra falha é
        // rede (ou servidor fora): entra com o último usuário deste aparelho.
        const u = e?.status === 401 ? null : lembrado()
        if (e?.status === 401) esquecer()
        if (u) { setUser(u); setState('in') } else setState('out')
      })
  }, [])

  if (state === 'checking') {
    return (
      <div className="login-bg">
        <div className="spin" style={{ width: 26, height: 26 }} />
      </div>
    )
  }
  // visitante deslogado cai no acionamento público; a equipe entra pelo
  // link "Acesso da equipe" (state 'login')
  if (state === 'out') {
    return <Acionamento onLogin={() => setState('login')} />
  }
  if (state === 'login') {
    return <Login onAuth={(u) => { lembrar(u); setUser(u); setState('in') }} />
  }
  // onRelogin: a sessão venceu com itens por enviar — volta ao login sem
  // apagar nada do aparelho; ao entrar de novo a caixa de saída sobe
  return (
    <App user={user}
      onLogout={() => { esquecer(); setUser(null); setState('out') }}
      onRelogin={() => setState('login')} />
  )
}

createRoot(document.getElementById('root')).render(<Root />)
