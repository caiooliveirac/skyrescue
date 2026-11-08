import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/backend.js'
import { IconCalendar, IconX, IconAlert } from './Icons.jsx'


// Tela "Escala dos internos" (#escala). O admin e os próprios internos alocam,
// tiram e trocam internos nos turnos de cada dia (os plantões de quem está
// logado ficam em destaque). Gestor só consulta. Toda mudança aparece no
// "Histórico de alterações" para todos — quem mexeu, quando e o quê.
// Quem pode o quê é conferido no servidor (/api/escala), não só aqui.

export const TURNOS = [['diurno', 'Diurno'], ['manha', 'Manhã'], ['tarde', 'Tarde']]
const TURNO_LABEL = Object.fromEntries(TURNOS)
const SEMANA = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']

// dias como 'AAAA-MM-DD' (data de Salvador). Conta ao meio-dia UTC para o
// fuso do aparelho nunca empurrar a data para o dia vizinho.
const hojeSSA = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bahia' })
const meioDia = (d) => new Date(d + 'T12:00:00Z')
const somaDias = (d, n) => new Date(meioDia(d).getTime() + n * 86400_000).toISOString().slice(0, 10)
const idxSemana = (d) => (meioDia(d).getUTCDay() + 6) % 7 // seg = 0
const segunda = (d) => somaDias(d, -idxSemana(d))
const ddmm = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`
const diaCurto = (d) => `${SEMANA[idxSemana(d)]} ${ddmm(d)}`

// mesma regra do servidor: "diurno" cobre o dia todo e não soma com outro turno
const conflita = (turno, turnosNoDia) =>
  turnosNoDia.includes(turno) || (turnosNoDia.length > 0 && (turno === 'diurno' || turnosNoDia.includes('diurno')))

const quando = (iso) => new Date(iso).toLocaleString('pt-BR', {
  timeZone: 'America/Bahia', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
}).replace(',', '')

// "Fulano (@login) tirou Beltrano e colocou Cicrano no lugar"
function LinhaHistorico({ h }) {
  const quem = <><b>{h.ator_nome || h.ator_login}</b> <span className="esc-login">@{h.ator_login}</span></>
  const sai = <b>{h.sai_nome || 'interno removido'}</b>
  const entra = <b>{h.entra_nome || 'interno removido'}</b>
  return (
    <li>
      <span className="esc-h-quando">{quando(h.at)}</span>
      <span>
        {quem}{' '}
        {h.acao === 'escalou' && <>escalou {entra}</>}
        {h.acao === 'tirou' && <>tirou {sai}</>}
        {h.acao === 'trocou' && <>tirou {sai} e colocou {entra} no lugar</>}
        {' '}<span className="esc-h-onde">· {TURNO_LABEL[h.turno] || h.turno} de {diaCurto(h.dia)}</span>
      </span>
    </li>
  )
}

function Kpi({ label, value, sub }) {
  return (
    <div className="st-kpi">
      <div className="st-kpi-l">{label}</div>
      <div className="st-kpi-v">{value}</div>
      {sub && <div className="st-kpi-s">{sub}</div>}
    </div>
  )
}

export default function Escala({ user, onClose }) {
  // admin e internos editam; gestor só consulta
  const editor = user?.role === 'admin' || Boolean(user?.interno)
  const hoje = hojeSSA()
  const [ini, setIni] = useState(() => segunda(hoje))
  const fim = somaDias(ini, 6)
  const dias = useMemo(() => Array.from({ length: 7 }, (_, i) => somaDias(ini, i)), [ini])
  const [data, setData] = useState(null)
  const [rev, setRev] = useState(0) // recarrega depois de alocar/tirar
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [trocando, setTrocando] = useState(null) // id do plantão com o seletor de troca aberto

  useEffect(() => {
    let vivo = true // trocar de semana rápido não deixa a resposta velha pintar a nova
    api.escala(ini, fim)
      .then((r) => { if (vivo) { setData({ ...r, ini }); setErr('') } })
      .catch((e) => { if (vivo) setErr(e.status ? e.message : 'sem conexão com o servidor') })
    return () => { vivo = false }
  }, [ini, fim, rev])

  const pronto = data?.ini === ini
  const plantoes = pronto ? data.plantoes : []
  const internos = pronto ? data.internos : []
  const slot = useMemo(() => {
    const m = new Map()
    for (const p of plantoes) {
      const k = `${p.dia}|${p.turno}`
      m.set(k, [...(m.get(k) || []), p])
    }
    return m
  }, [plantoes])
  const turnosDe = (dia, userId) => plantoes.filter((p) => p.dia === dia && p.user_id === userId).map((p) => p.turno)

  const escalar = async (dia, turno, userId) => {
    if (!userId) return
    setBusy(true); setErr('')
    try { await api.escalar({ dia, turno, user_id: Number(userId) }); setRev((n) => n + 1) }
    catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  const trocar = async (p, userId) => {
    if (!userId) return
    const novo = internos.find((i) => i.id === Number(userId))
    if (!confirm(`Trocar ${p.nome} por ${novo?.nome} no turno ${TURNO_LABEL[p.turno].toLowerCase()} de ${diaCurto(p.dia)}?\nA troca fica registrada no histórico com o seu login.`)) return
    setBusy(true); setErr('')
    try { await api.trocarEscala(p.id, Number(userId)); setTrocando(null); setRev((n) => n + 1) }
    catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  const tirar = async (p) => {
    if (!confirm(`Tirar ${p.nome} do turno ${TURNO_LABEL[p.turno].toLowerCase()} de ${diaCurto(p.dia)}?\nFica registrado no histórico com o seu login.`)) return
    setBusy(true); setErr('')
    try { await api.desescalar(p.id); setRev((n) => n + 1) }
    catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  const escalados = new Set(plantoes.map((p) => p.user_id)).size
  const diasVazios = dias.filter((d) => !plantoes.some((p) => p.dia === d)).length

  return (
    <div className="st-page">
      <div className="st-head">
        <div className="st-title">
          <IconCalendar size={20} />
          <div>
            <h1>Escala dos internos</h1>
            <div className="small">
              Semana de {ddmm(ini)} a {ddmm(fim)}
              {pronto ? ` · ${plantoes.length} plantõ${plantoes.length === 1 ? 'ão' : 'es'}` : ' · carregando…'}
            </div>
          </div>
        </div>
        <div className="spacer" />
        <button className="tbtn" onClick={onClose} title="Voltar"><IconX size={14} /> <span className="tlabel">Fechar</span></button>
      </div>

      <div className="st-body">
        <div className="row st-filtros">
          <button className="st-chip" onClick={() => setIni(somaDias(ini, -7))}>‹ Anterior</button>
          <button className={'st-chip' + (ini === segunda(hoje) ? ' on' : '')} onClick={() => setIni(segunda(hoje))}>Esta semana</button>
          <button className="st-chip" onClick={() => setIni(somaDias(ini, 7))}>Próxima ›</button>
          <input type="date" value={ini} aria-label="Ir para a semana do dia"
            onChange={(e) => { if (e.target.value) setIni(segunda(e.target.value)) }} />
        </div>

        {err && <div className="alert fail"><IconAlert size={15} /> {err}</div>}

        {!editor && (
          <div className="small esc-aviso">
            Escala mantida pela coordenação do GOA e pelos internos — aqui é só consulta. Toda alteração fica no histórico abaixo.
          </div>
        )}

        {pronto && user?.interno && (
          <section className="card esc-meus">
            <h2>Seus próximos plantões</h2>
            {data.proximos.length ? (
              <div className="esc-lista">
                {data.proximos.map((p) => (
                  <span key={p.id} className={'badge ' + (p.dia === hoje ? 'ok' : 'info')}>
                    {p.dia === hoje ? 'Hoje' : diaCurto(p.dia)} · {TURNO_LABEL[p.turno]}
                  </span>
                ))}
              </div>
            ) : <div className="small">Nenhum plantão marcado a partir de hoje.</div>}
          </section>
        )}

        {pronto && editor && (
          <>
            <div className="st-kpis">
              <Kpi label="Plantões na semana" value={plantoes.length} />
              <Kpi label="Internos escalados" value={escalados} sub={`de ${internos.length} cadastrado${internos.length === 1 ? '' : 's'}`} />
              <Kpi label="Dias sem interno" value={diasVazios} sub="nesta semana" />
            </div>
            {!internos.length && (
              <div className="alert warn esc-aviso">
                <IconAlert size={15} />
                <span>Nenhum interno cadastrado. Interno é o usuário com acesso ao portal — no servidor:
                  {' '}<code>node scripts/acesso-portal.js &lt;usuário&gt; on</code></span>
              </div>
            )}
          </>
        )}

        {!pronto && !err && <div className="st-loading"><div className="spin" /></div>}

        {pronto && (
          <div className="esc-semana">
            {dias.map((d) => {
              const doDia = plantoes.filter((p) => p.dia === d)
              // quem consulta vê só os turnos com gente; quem edita vê todos para alocar
              const turnos = editor ? TURNOS : TURNOS.filter(([t]) => slot.has(`${d}|${t}`))
              return (
                <section key={d} className={'card esc-dia' + (d === hoje ? ' hoje' : d < hoje ? ' passado' : '')}>
                  <h2>
                    {SEMANA[idxSemana(d)]} <span className="esc-data">{ddmm(d)}</span>
                    {d === hoje && <span className="badge info">hoje</span>}
                  </h2>
                  {!doDia.length && !editor && <div className="small">Ninguém escalado.</div>}
                  {turnos.map(([t, label]) => {
                    const lista = slot.get(`${d}|${t}`) || []
                    const livres = editor ? internos.filter((i) => !conflita(t, turnosDe(d, i.id))) : []
                    return (
                      <div className="esc-turno" key={t}>
                        <div className="esc-tl">{label}</div>
                        <div className="esc-nomes">
                          {lista.map((p) => (
                            <span key={p.id} className={'esc-nome' + (p.user_id === user?.id ? ' eu' : '')}>
                              {p.nome}
                              {editor && (
                                <button className="esc-troca" onClick={() => setTrocando(trocando === p.id ? null : p.id)} disabled={busy}
                                  title={`Trocar ${p.nome} por outro interno`} aria-label={`Trocar ${p.nome}`}>⇄</button>
                              )}
                              {editor && (
                                <button onClick={() => tirar(p)} disabled={busy} title={`Tirar ${p.nome} da escala`} aria-label={`Tirar ${p.nome}`}>
                                  <IconX size={11} />
                                </button>
                              )}
                            </span>
                          ))}
                          {editor && !lista.length && !livres.length && <span className="small">—</span>}
                        </div>
                        {editor && lista.filter((p) => p.id === trocando).map((p) => {
                          const opcoes = internos.filter((i) => i.id !== p.user_id && !lista.some((q) => q.user_id === i.id)
                            && !conflita(t, turnosDe(d, i.id)))
                          return opcoes.length ? (
                            <select key={p.id} className="esc-add esc-trocar" value="" disabled={busy} autoFocus
                              aria-label={`Trocar ${p.nome} por`} onChange={(e) => trocar(p, e.target.value)}>
                              <option value="">⇄ trocar {p.nome} por…</option>
                              {opcoes.map((i) => <option key={i.id} value={i.id}>{i.nome}</option>)}
                            </select>
                          ) : <div key={p.id} className="small">Nenhum interno livre para trocar com {p.nome}.</div>
                        })}
                        {editor && livres.length > 0 && (
                          <select className="esc-add" value="" disabled={busy} aria-label={`Escalar no turno ${label} de ${diaCurto(d)}`}
                            onChange={(e) => escalar(d, t, e.target.value)}>
                            <option value="">+ interno</option>
                            {livres.map((i) => <option key={i.id} value={i.id}>{i.nome}</option>)}
                          </select>
                        )}
                      </div>
                    )
                  })}
                </section>
              )
            })}
          </div>
        )}

        {pronto && (
          <section className="card esc-historico">
            <h2>Histórico de alterações da semana</h2>
            <div className="small">Quem escalou, tirou ou trocou alguém nestes dias — com login e horário.</div>
            {data.historico?.length ? (
              <ul>{data.historico.map((h) => <LinhaHistorico key={h.id} h={h} />)}</ul>
            ) : <div className="small esc-h-vazio">Nenhuma alteração registrada nesta semana.</div>}
          </section>
        )}
      </div>
    </div>
  )
}
