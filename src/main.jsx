import React, { useState, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import Login from './components/Login.jsx'
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
  if (state === 'out') {
    return <Login onAuth={(u) => { setUser(u); setState('in') }} />
  }
  return <App user={user} onLogout={() => { setUser(null); setState('out') }} />
}

createRoot(document.getElementById('root')).render(<Root />)
