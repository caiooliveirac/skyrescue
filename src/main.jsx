import React, { useState, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import Login from './components/Login.jsx'
import Acionamento from './components/Acionamento.jsx'
import { api } from './lib/backend.js'
import './styles.css'

function Root() {
  const [state, setState] = useState('checking') // 'checking' | 'in' | 'out'
  const [user, setUser] = useState(null)

  useEffect(() => {
    api.me()
      .then(({ user }) => { setUser(user); setState('in') })
      .catch(() => setState('out'))
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
    return <Login onAuth={(u) => { setUser(u); setState('in') }} />
  }
  return <App user={user} onLogout={() => { setUser(null); setState('out') }} />
}

createRoot(document.getElementById('root')).render(<Root />)
