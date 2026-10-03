import { useEffect, useState } from 'react'
import * as outbox from '../lib/outbox.js'

// Indicador permanente do que este aparelho ainda deve ao servidor:
// offline / N a enviar / sincronizado. É ele que diz ao plantonista, em voo,
// que o que foi digitado está guardado e vai subir sozinho.
export default function SyncBadge({ userId, onRelogin }) {
  const [, tick] = useState(0)
  useEffect(() => outbox.subscribe(() => tick((n) => n + 1)), [])
  const s = outbox.status(userId)
  const itens = (n) => `${n} ${n === 1 ? 'item' : 'itens'}`

  if (s.dead) {
    return (
      <button className="tbtn sync fail"
        title="O servidor recusou estes envios (caso apagado, por exemplo). Toque para descartá-los."
        onClick={() => { if (confirm(`Descartar ${itens(s.dead)} que o servidor recusou? O que foi digitado continua neste aparelho.`)) outbox.discardDead(userId) }}>
        {itens(s.dead)} recusado{s.dead > 1 ? 's' : ''}
      </button>
    )
  }
  if (s.auth === 'needed' && s.pending) {
    return (
      <button className="tbtn sync warn" onClick={onRelogin}
        title="A sessão venceu. Entre de novo para enviar o que está guardado neste aparelho.">
        Entrar para enviar {itens(s.pending)}
      </button>
    )
  }
  if (!s.online) {
    return (
      <span className="sync warn" title="Sem conexão com o servidor. O que você registrar fica guardado neste aparelho e sobe sozinho quando a rede voltar.">
        offline{s.pending ? ` · ${itens(s.pending)} a enviar` : ''}
      </span>
    )
  }
  if (s.pending) {
    return <span className="sync warn" title="Guardado neste aparelho; enviando ao servidor.">{itens(s.pending)} a enviar</span>
  }
  return (
    <span className="sync ok" title={s.others ? `Há ${itens(s.others)} de outro usuário neste aparelho, esperando o login dele.` : 'Tudo o que foi registrado neste aparelho está no servidor.'}>
      sincronizado
    </span>
  )
}
