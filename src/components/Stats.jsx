import React, { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/backend.js'
import { aggregate, diagnose, resumoAcionamentos, MARCOS, MARCO_LABEL } from '../lib/stats.js'
import { ITEM_BY_ID } from '../lib/score.js'
import { fmtMin, fmtKm } from '../lib/geo.js'
import { IconChart, IconX, IconAlert } from './Icons.jsx'

// Tela "Estatísticas" (#stats): números das ocorrências registradas para
// apresentar o serviço, mais o diagnóstico de cada caso — que horário não
// serve para conta e por quê. Tudo calculado aqui a partir de /api/stats
// (src/lib/stats.js); período e casos tirados da conta ficam só neste aparelho.

const PREF = 'skyrescue_stats_v1'
const lerPref = () => { try { return JSON.parse(localStorage.getItem(PREF)) || {} } catch (e) { return {} } }
const gravarPref = (p) => { try { localStorage.setItem(PREF, JSON.stringify(p)) } catch (e) { /* ok */ } }

const PERIODOS = [['30', '30 dias'], ['90', '90 dias'], ['365', '12 meses'], ['tudo', 'Tudo'], ['custom', 'Datas']]
// cores das etapas: paleta categórica validada (CVD/contraste) no fundo escuro do app
const COR_ETAPA = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#9085e9']
const FAIXA = { red: ['Forte indicação (≥ 9)', 'fail'], yellow: ['Avaliação do MR (5–8)', 'warn'], green: ['Terrestre preferencial (0–4)', 'ok'] }
const NIVEL = { ok: ['ok', 'Horários ok'], parcial: ['warn', 'Faltam marcos'], erro: ['fail', 'Horário não confiável'], vazio: ['fail', 'Sem horários'] }

const dia = (ms) => new Date(ms).toLocaleDateString('pt-BR', { timeZone: 'America/Bahia', day: '2-digit', month: '2-digit', year: '2-digit' })
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0)
const sinal = (m) => (m == null ? '—' : `${m < 0 ? '−' : '+'}${fmtMin(Math.abs(m))}`)

function Kpi({ label, value, sub }) {
  return (
    <div className="st-kpi">
      <div className="st-kpi-l">{label}</div>
      <div className="st-kpi-v">{value}</div>
      {sub && <div className="st-kpi-s">{sub}</div>}
    </div>
  )
}

// barras horizontais, série única
function Bars({ items, fmt = (n) => n, total, max = 12, cor }) {
  const [todos, setTodos] = useState(false)
  if (!items.length) return <div className="small">Sem dados no período.</div>
  const top = Math.max(...items.map((i) => i.n), 1)
  const lista = todos ? items : items.slice(0, max)
  return (
    <div className="st-bars">
      {lista.map((i) => (
        <div className="st-bar" key={i.label} title={`${i.label}: ${fmt(i.n)}${total ? ` (${pct(i.n, total)}%)` : ''}`}>
          <span className="st-bar-l">{i.label}</span>
          <span className="st-bar-t"><span className={'st-bar-f ' + (i.cls || '')} style={{ width: `${(i.n / top) * 100}%`, minWidth: i.n ? 2 : 0, background: cor }} /></span>
          <span className="st-bar-v">{fmt(i.n)}{total ? <small> {pct(i.n, total)}%</small> : null}</span>
        </div>
      ))}
      {items.length > max && (
        <button className="btn xs sec" onClick={() => setTodos(!todos)}>{todos ? 'Mostrar menos' : `Mostrar todos (${items.length})`}</button>
      )}
    </div>
  )
}

// colunas verticais (mês, dia da semana, hora)
function Cols({ items, rotulo = (i) => i.label, legenda }) {
  const top = Math.max(...items.map((i) => i.n), 1)
  return (
    <div>
      <div className="st-cols" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map((i) => (
          <div className="st-col" key={i.label} title={`${legenda ? legenda(i) : i.label}: ${i.n} ocorrência${i.n === 1 ? '' : 's'}`}>
            <span className="st-col-v">{i.n || ''}</span>
            <span className="st-col-b" style={{ height: `${(i.n / top) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="st-cols st-cols-l" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map((i) => <span key={i.label}>{rotulo(i)}</span>)}
      </div>
    </div>
  )
}

function Card({ title, sub, wide, children }) {
  return (
    <section className={'card st-card' + (wide ? ' wide' : '')}>
      <h2>{title}</h2>
      {sub && <div className="small st-sub">{sub}</div>}
      {children}
    </section>
  )
}

// missão típica: medianas das etapas lado a lado + tabela
function MissaoTipica({ etapas, totais }) {
  const comDado = etapas.filter((e) => e.n)
  const soma = comDado.reduce((s, e) => s + e.med, 0)
  return (
    <>
      {soma > 0 && (
        <div className="st-stack" role="img" aria-label={comDado.map((e) => `${e.label} ${fmtMin(e.med)}`).join(', ')}>
          {etapas.map((e, i) => e.n ? (
            <span key={e.id} className="st-seg" title={`${e.label}: mediana ${fmtMin(e.med)} (n=${e.n})`}
              style={{ flexGrow: e.med, background: COR_ETAPA[i] }}>
              {e.med / soma > 0.09 ? fmtMin(e.med) : ''}
            </span>
          ) : null)}
        </div>
      )}
      <div className="st-legend">
        {etapas.map((e, i) => (
          <span key={e.id}><i style={{ background: COR_ETAPA[i] }} />{e.label}</span>
        ))}
      </div>
      <div className="st-tablewrap">
        <table className="st-table">
          <thead>
            <tr><th>Etapa</th><th title="casos com os dois horários confiáveis / casos com os dois horários">n</th><th>Mediana</th><th>Metade central (P25–P75)</th><th>P90</th><th>Mín–máx</th></tr>
          </thead>
          <tbody>
            {[...etapas, ...totais].map((e, i) => (
              <tr key={e.id} className={i >= etapas.length ? 'tot' : ''}>
                <td>{i < etapas.length && <i className="sw" style={{ background: COR_ETAPA[i] }} />}{e.label}</td>
                <td className="num">{e.n}<span className="small">/{e.comAmbos}</span></td>
                <td className="num b">{e.n ? fmtMin(e.med) : '—'}</td>
                <td className="num">{e.n ? `${fmtMin(e.p25)} – ${fmtMin(e.p75)}` : '—'}</td>
                <td className="num">{e.n ? fmtMin(e.p90) : '—'}</td>
                <td className="num">{e.n ? `${fmtMin(e.min)} – ${fmtMin(e.max)}` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="small st-note">
        A barra soma as medianas de cada etapa ({fmtMin(soma)}); a mediana do total vem só dos casos com o total confiável, por isso os dois números diferem.
        "n" = casos que entraram na conta / casos com os dois horários marcados — a diferença é horário que o diagnóstico descartou.
      </div>
    </>
  )
}

// real × estimativa do app no momento da decisão, caso a caso
function RealEstimado({ comparacao, ganho, errEst }) {
  if (!comparacao.length) return <div className="small">Nenhum caso com o tempo total confiável no período.</div>
  const top = Math.ceil(Math.max(...comparacao.flatMap((x) => [x.real, x.aereo || 0, x.terrestre || 0])) / 30) * 30
  const x = (m) => `${(m / top) * 100}%`
  const ticks = []
  for (let t = 0; t <= top; t += top > 180 ? 60 : 30) ticks.push(t)
  const menor = comparacao.filter((c) => c.terrestre != null && c.real < c.terrestre).length
  const comT = comparacao.filter((c) => c.terrestre != null).length
  return (
    <>
      <div className="st-kpis">
        <Kpi label="Ganho real × terrestre estimado" value={ganho.n ? sinal(ganho.med) : '—'} sub={ganho.n ? `mediana · ${menor} de ${comT} casos mais rápidos de helicóptero` : 'sem estimativa terrestre'} />
        <Kpi label="Real acima da estimativa aérea" value={errEst.n ? sinal(errEst.med) : '—'} sub={errEst.n ? `mediana · P25–P75 ${fmtMin(errEst.p25)} – ${fmtMin(errEst.p75)}` : ''} />
      </div>
      <div className="st-legend">
        <span><i className="dot real" />Real (acionamento → acolhido)</span>
        <span><i className="dot aereo" />Estimativa aérea</span>
        <span><i className="dot terr" />Estimativa terrestre (ambulância)</span>
      </div>
      <div className="st-db">
        <div className="st-db-axis">
          {ticks.map((t) => <span key={t} style={{ left: x(t) }}>{t % 60 === 0 ? `${t / 60} h` : `${t} min`}</span>)}
        </div>
        {comparacao.map((c) => {
          const vals = [c.real, c.aereo, c.terrestre].filter((v) => v != null)
          return (
            <div className="st-db-row" key={c.id}>
              <span className="st-db-l" title={c.tag || ''}>{dia(c.quando)} <small>{c.ref}</small></span>
              <span className="st-db-t">
                {ticks.map((t) => <i key={t} className="grid" style={{ left: x(t) }} />)}
                <i className="line" style={{ left: x(Math.min(...vals)), width: `${((Math.max(...vals) - Math.min(...vals)) / top) * 100}%` }} />
                {c.terrestre != null && <i className="mk terr" style={{ left: x(c.terrestre) }} title={`Estimativa terrestre ${fmtMin(c.terrestre)}`} />}
                {c.aereo != null && <i className="mk aereo" style={{ left: x(c.aereo) }} title={`Estimativa aérea ${fmtMin(c.aereo)}`} />}
                <i className="mk real" style={{ left: x(c.real) }} title={`Real ${fmtMin(c.real)}`} />
              </span>
            </div>
          )
        })}
      </div>
      <div className="small st-note">
        Estimativas gravadas pelo app na hora da decisão: aérea = acionamento + voos + embarque + desembarque/transbordo; terrestre = ETA da
        ambulância + cena + rota até o hospital. O real fica acima da aérea quando há espera na cena (ambulância, preparo do paciente) — tempo que o modelo não prevê.
      </div>
    </>
  )
}

function Diagnostico({ linhas, excluidos, alternar, limpar }) {
  const [filtro, setFiltro] = useState('problema')
  const vis = linhas.filter(({ d }) => filtro === 'todos' || (filtro === 'problema' ? d.nivel !== 'ok' : d.nivel === 'ok'))
  return (
    <>
      <div className="row st-filtros">
        {[['problema', 'Com problema'], ['ok', 'Ok'], ['todos', 'Todos']].map(([k, l]) => (
          <button key={k} className={'st-chip' + (filtro === k ? ' on' : '')} onClick={() => setFiltro(k)}>
            {l} ({linhas.filter(({ d }) => k === 'todos' || (k === 'problema' ? d.nivel !== 'ok' : d.nivel === 'ok')).length})
          </button>
        ))}
        {excluidos.size > 0 && <button className="btn xs sec" onClick={limpar}>Voltar {excluidos.size} caso{excluidos.size > 1 ? 's' : ''} para a conta</button>}
      </div>
      <div className="st-tablewrap">
        <table className="st-table st-diag">
          <thead>
            <tr><th title="desmarque para tirar o caso de todas as contas desta tela">Conta</th><th>Caso</th><th>Marcos</th><th>Situação</th></tr>
          </thead>
          <tbody>
            {vis.map(({ c, d }) => (
              <tr key={c.id} className={excluidos.has(c.id) ? 'fora' : ''}>
                <td><input type="checkbox" checked={!excluidos.has(c.id)} onChange={() => alternar(c.id)} aria-label={`Contar o caso ${c.case_ref || c.id}`} /></td>
                <td>
                  <b>{dia(d.ev.decisao ?? new Date(c.created_at).getTime())}</b> <span className="mono">{c.case_ref || `#${c.id}`}</span>
                  <div className="small">{c.tag || 'sem tipo'}{c.autor ? ` · ${c.autor}` : ''}</div>
                </td>
                <td>
                  <span className="st-marcos">
                    {MARCOS.map((k) => (
                      <i key={k} className={d.ev[k] == null ? 'falta' : d.suspeitos.has(k) ? 'susp' : 'ok'}
                        title={`${MARCO_LABEL[k]}: ${d.ev[k] == null ? 'não marcado' : new Date(d.ev[k]).toLocaleString('pt-BR', { timeZone: 'America/Bahia' }) + (d.suspeitos.has(k) ? ' — fora da conta' : '')}`} />
                    ))}
                  </span>
                </td>
                <td>
                  <span className={'badge ' + NIVEL[d.nivel][0]}>{NIVEL[d.nivel][1]}</span>
                  {d.problemas.map((p, i) => <div key={i} className={'st-prob ' + p.nivel}>{p.texto}</div>)}
                </td>
              </tr>
            ))}
            {!vis.length && <tr><td colSpan={4} className="small">Nenhum caso neste filtro.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="small st-note">
        Marcos: <i className="st-leg ok" /> horário usado · <i className="st-leg susp" /> marcado em sequência, em outro dia ou fora de ordem (fica fora das contas de tempo) · <i className="st-leg falta" /> não marcado.
        Caso desmarcado em "Conta" sai de todos os números desta tela (só neste aparelho) — use para teste, simulação ou ocorrência duplicada.
      </div>
    </>
  )
}

export default function Stats({ base, onClose }) {
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  useEffect(() => {
    api.stats().then(setData).catch((e) => setErr(e.status ? e.message : 'sem conexão com o servidor'))
  }, [])
  return <Painel data={data} err={err} base={base} onClose={onClose} />
}

// a página em si, a partir do que /api/stats devolveu
export function Painel({ data, err, base, onClose }) {
  const [pref, setPref] = useState(lerPref)
  const periodo = pref.periodo || 'tudo'
  const excluidos = useMemo(() => new Set(pref.excluidos || []), [pref.excluidos])
  const mudar = (p) => setPref((old) => { const n = { ...old, ...p }; gravarPref(n); return n })

  const faixa = useMemo(() => {
    let ini = -Infinity, fim = Infinity
    if (/^\d+$/.test(periodo)) ini = Date.now() - Number(periodo) * 86400_000
    if (periodo === 'custom') {
      if (pref.de) ini = new Date(pref.de + 'T00:00:00-03:00').getTime()
      if (pref.ate) fim = new Date(pref.ate + 'T23:59:59-03:00').getTime()
    }
    return (iso) => { const t = new Date(iso).getTime(); return t >= ini && t <= fim }
  }, [periodo, pref.de, pref.ate])
  const noPeriodo = useMemo(() => (data ? data.cases.filter((c) => faixa(c.created_at)) : []), [data, faixa])
  const contados = useMemo(() => noPeriodo.filter((c) => !excluidos.has(c.id)), [noPeriodo, excluidos])
  const ag = useMemo(() => aggregate(contados, { base }), [contados, base])
  const linhas = useMemo(() => noPeriodo.map((c) => ({ c, d: diagnose(c) })).reverse(), [noPeriodo])
  const acion = useMemo(() => (data ? resumoAcionamentos(data.acionamentos.filter((a) => faixa(a.created_at))) : null), [data, faixa])

  const alternar = (id) => {
    const s = new Set(excluidos)
    s.has(id) ? s.delete(id) : s.add(id)
    mudar({ excluidos: [...s] })
  }

  const total = ag.totais.find((t) => t.id === 'total')
  const atePac = ag.totais.find((t) => t.id === 'ate_paciente')
  const comHorario = ag.n - ag.diag.vazio
  const reg = ag.registro
  const regTot = reg.aoVivo + reg.depois + reg.suspeitos

  return (
    <div className="st-page">
      <div className="st-head">
        <div className="st-title">
          <IconChart size={20} />
          <div>
            <h1>Estatísticas</h1>
            <div className="small">
              {data ? <>{ag.n} ocorrência{ag.n === 1 ? '' : 's'} na conta{excluidos.size ? ` · ${noPeriodo.length - ag.n} tirada${noPeriodo.length - ag.n === 1 ? '' : 's'} da conta` : ''}</> : 'carregando…'}
            </div>
          </div>
        </div>
        <div className="spacer" />
        <button className="tbtn" onClick={onClose} title="Voltar ao caso"><IconX size={14} /> <span className="tlabel">Fechar</span></button>
      </div>

      <div className="st-body">
        <div className="row st-filtros">
          {PERIODOS.map(([k, l]) => (
            <button key={k} className={'st-chip' + (periodo === k ? ' on' : '')} onClick={() => mudar({ periodo: k })}>{l}</button>
          ))}
          {periodo === 'custom' && (
            <>
              <input type="date" value={pref.de || ''} onChange={(e) => mudar({ de: e.target.value })} aria-label="De" />
              <input type="date" value={pref.ate || ''} onChange={(e) => mudar({ ate: e.target.value })} aria-label="Até" />
            </>
          )}
        </div>

        {err && <div className="alert fail"><IconAlert size={15} /> Não foi possível carregar: {err}</div>}
        {!data && !err && <div className="st-loading"><div className="spin" /></div>}

        {data && (
          <div className="st-grid">
            <div className="st-kpis wide">
              <Kpi label="Ocorrências" value={ag.n} sub={`${ag.concluidas} com paciente acolhido${ag.canceladas ? ` · ${ag.canceladas} canceladas` : ''}`} />
              <Kpi label="Acionamento → paciente acolhido" value={total.n ? fmtMin(total.med) : '—'} sub={total.n ? `mediana · n=${total.n} · P90 ${fmtMin(total.p90)}` : 'sem casos confiáveis'} />
              <Kpi label="Acionamento → contato c/ paciente" value={atePac.n ? fmtMin(atePac.med) : '—'} sub={atePac.n ? `mediana · n=${atePac.n}` : ''} />
              <Kpi label="Ganho estimado sobre a ambulância" value={ag.ganhoEst.n ? fmtMin(ag.ganhoEst.med) : '—'} sub={ag.ganhoEst.n ? `mediana da estimativa na decisão · n=${ag.ganhoEst.n}` : ''} />
              <Kpi label="Distância base → cena" value={ag.distancia.n ? fmtKm(ag.distancia.med) : '—'} sub={ag.distancia.n ? `mediana · até ${fmtKm(ag.distancia.max)}` : ''} />
              <Kpi label="Casos com horários ok" value={`${pct(ag.diag.ok, comHorario)}%`} sub={`${ag.diag.ok} de ${comHorario} com horário · ${ag.diag.erro} não confiáveis`} />
            </div>

            <Card wide title="Missão típica — tempo por etapa" sub="Do acionamento autorizado ao paciente acolhido na unidade. Só entram intervalos com as duas pontas confiáveis (ver Diagnóstico).">
              <MissaoTipica etapas={ag.etapas} totais={ag.totais} />
            </Card>

            <Card wide title="Tempo real × estimativa do app" sub="Cada linha é um caso com o tempo total confiável.">
              <RealEstimado comparacao={ag.comparacao} ganho={ag.ganho} errEst={ag.errEst} />
            </Card>

            <Card title="Tipo de ocorrência" sub="Critério principal marcado no caso">
              <Bars items={ag.porTipo} total={ag.n} />
            </Card>

            <Card title="Tempo por tipo" sub="Medianas; só casos com o intervalo confiável">
              <div className="st-tablewrap">
                <table className="st-table">
                  <thead><tr><th>Tipo</th><th>Casos</th><th>Até o paciente</th><th>Até acolhido</th></tr></thead>
                  <tbody>
                    {ag.porTipo.map((t) => (
                      <tr key={t.label}>
                        <td>{t.label}</td>
                        <td className="num">{t.n}</td>
                        <td className="num">{t.ate_paciente.n ? <>{fmtMin(t.ate_paciente.med)} <span className="small">n={t.ate_paciente.n}</span></> : '—'}</td>
                        <td className="num">{t.total.n ? <>{fmtMin(t.total.med)} <span className="small">n={t.total.n}</span></> : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card title="Faixa da pontuação" sub={ag.score.n ? `Pontuação mediana ${Math.round(ag.score.med)} (de ${ag.score.min} a ${ag.score.max})` : ''}>
              <Bars total={ag.n} items={ag.porFaixa.map((f) => ({ label: FAIXA[f.key][0], n: f.n, cls: FAIXA[f.key][1] }))} />
              {ag.gatesNaoOk > 0 && <div className="small st-note">{ag.gatesNaoOk} caso{ag.gatesNaoOk > 1 ? 's' : ''} com algum gate operacional não confirmado na gravação.</div>}
            </Card>

            <Card title="Critérios mais marcados" sub="Um caso marca vários">
              <Bars items={ag.porCriterio.map((i) => ({ ...i, label: ITEM_BY_ID[i.label]?.label || i.label }))} total={ag.n} max={10} />
            </Card>

            <Card title="Hospital de destino">
              <Bars items={ag.porHospital} total={ag.n} />
            </Card>

            <Card title="Município da cena">
              <Bars items={ag.porMunicipio} total={ag.n} max={10} />
            </Card>

            <Card title="Distância da base à cena" sub="Em linha reta, da base do GOA (Simões Filho)">
              <Bars items={ag.porDistancia} total={ag.n} />
            </Card>

            <Card title="Ocorrências por mês">
              <Cols items={ag.porMes} />
            </Card>

            <Card title="Dia da semana">
              <Cols items={ag.porSemana} />
            </Card>

            <Card title="Hora do acionamento" sub="Hora local do acionamento autorizado (ou da criação do caso)">
              <Cols items={ag.porHora} rotulo={(i) => (Number(i.label) % 3 === 0 ? i.label : '')} legenda={(i) => `${i.label}h`} />
            </Card>

            <Card title="Como os horários foram registrados" sub="Cada horário marcado nos casos do período">
              {regTot > 0 && (
                <>
                  <div className="st-stack">
                    {[['aoVivo', 'Tocado na hora', '#199e70'], ['depois', 'Lançado depois', '#c98500'], ['suspeitos', 'Não confiável', '#d55181']].map(([k, l, cor]) => reg[k] ? (
                      <span key={k} className="st-seg" style={{ flexGrow: reg[k], background: cor }} title={`${l}: ${reg[k]}`}>{pct(reg[k], regTot) >= 10 ? `${pct(reg[k], regTot)}%` : ''}</span>
                    ) : null)}
                  </div>
                  <div className="st-legend">
                    <span><i style={{ background: '#199e70' }} />Tocado na hora · {reg.aoVivo}</span>
                    <span><i style={{ background: '#c98500' }} />Lançado depois (digitado ou &gt; 15 min) · {reg.depois}</span>
                    <span><i style={{ background: '#d55181' }} />Não confiável · {reg.suspeitos}</span>
                  </div>
                </>
              )}
              <h4 className="st-h4">Casos por quem registrou</h4>
              <Bars items={ag.porAutor} total={ag.n} max={8} />
            </Card>

            {acion && (
              <Card title="Pedidos pela tela “Acionar GOA”" sub={`${acion.n} pedido${acion.n === 1 ? '' : 's'} pelo site · ${acion.completos} completado${acion.completos === 1 ? '' : 's'} na 2ª etapa · ${acion.avisoOk} com aviso entregue`}>
                <Bars items={acion.porTipo} total={acion.n} />
              </Card>
            )}

            <Card wide title="Diagnóstico dos dados" sub="Por que um horário fica fora das contas de tempo, caso a caso">
              <div className="st-kpis">
                <Kpi label="Horários ok" value={ag.diag.ok} />
                <Kpi label="Faltam marcos" value={ag.diag.parcial} />
                <Kpi label="Horário não confiável" value={ag.diag.erro} />
                <Kpi label="Sem horários" value={ag.diag.vazio} />
              </div>
              <Diagnostico linhas={linhas} excluidos={excluidos} alternar={alternar} limpar={() => mudar({ excluidos: [] })} />
            </Card>
          </div>
        )}
      </div>
    </div>
  )
}
