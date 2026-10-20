import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../lib/backend.js'
import { IconCheck, IconX, IconAlert } from './Icons.jsx'
import { preparePhoto } from '../lib/photo.js'

// Checklist diário da base GOA, em tela cheia e pensado para o polegar (mesmo
// fluxo do checklists.mnrs.com.br): uma seção por vez, toque no item = conforme,
// botão lateral = falta/observação, chips de seção, revisão e envio. Os itens vêm
// de lá (via servidor); o envio entra lá e aparece no painel deles.
// Rascunho do dia fica no aparelho.
const isoDia = (d) => d.toISOString().slice(0, 10)
const padrao = (it) => {
  if (it.autoDefault === 'today') return isoDia(new Date())
  if (it.autoDefault === 'tomorrow') return isoDia(new Date(Date.now() + 86400_000))
  return ''
}
const draftKey = (dia) => `checklist-goa-draft:${dia}`
const dm = (d) => d.split('-').reverse().slice(0, 2).join('/')
const hm = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Bahia' })
const lerDraft = (dia) => { try { return JSON.parse(localStorage.getItem(draftKey(dia))) } catch (e) { return null } }

export default function ChecklistGoaModal({ user, onClose }) {
  const [def, setDef] = useState(null)
  const [err, setErr] = useState('')
  const [answers, setAnswers] = useState({}) // key -> {key,state,obs?,value?}
  const [medico, setMedico] = useState('')
  const [fase, setFase] = useState(0) // 0..n-1 = seção, n = revisão
  const [sheet, setSheet] = useState(null) // item em edição de falta/obs
  const [sheetObs, setSheetObs] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)
  const [hist, setHist] = useState(null)   // histórico + alertas do último checklist
  const [ncs, setNcs] = useState([])        // inconformidades com foto (7 dias)
  const [showHist, setShowHist] = useState(false)
  const [showFoto, setShowFoto] = useState(false)
  const [lightbox, setLightbox] = useState(null)
  const [foto, setFoto] = useState(null)    // dataUrl pronta para subir
  const [fotoDesc, setFotoDesc] = useState('')
  const [fotoBusy, setFotoBusy] = useState(false)
  const [fotoErr, setFotoErr] = useState('')
  const fileRef = useRef(null)
  const hidratado = useRef(false)
  const topo = useRef(null)
  const dia = isoDia(new Date())

  useEffect(() => {
    api.getChecklistGoa().then((d) => {
      const rasc = lerDraft(dia)
      const ini = { ...(rasc?.answers || {}) }
      for (const g of d.groups) for (const it of g.items) {
        if (it.kind === 'check' || ini[it.key]) continue
        const v = d.ultimosCampos?.[it.key] || padrao(it)
        if (v) ini[it.key] = { key: it.key, state: 'ok', value: v }
      }
      setAnswers(ini)
      setMedico(rasc?.medico || d.plantonista || user?.full_name || user?.username || '')
      setDef(d)
      hidratado.current = true
    }).catch((e) => setErr(e.message))
  }, [])

  const carregarNcs = () => api.listNcGoa().then((r) => setNcs(r.items)).catch(() => setNcs([]))
  useEffect(() => {
    api.historyChecklistGoa().then(setHist).catch(() => setHist(null))
    carregarNcs()
  }, [])

  const escolherFoto = async (file) => {
    if (!file) return
    setFotoErr('')
    try { setFoto((await preparePhoto(file)).dataUrl) } catch (e) { setFotoErr(e.message) }
  }
  const enviarFoto = async () => {
    setFotoErr(''); setFotoBusy(true)
    try {
      await api.sendNcGoa({ doctorName: medico.trim(), description: fotoDesc.trim(), photo: foto })
      setShowFoto(false); setFoto(null); setFotoDesc(''); carregarNcs()
    } catch (e) { setFotoErr(e.message) } finally { setFotoBusy(false) }
  }

  useEffect(() => {
    if (!hidratado.current) return
    try { localStorage.setItem(draftKey(dia), JSON.stringify({ answers, medico })) } catch (e) { /* sem armazenamento */ }
  }, [answers, medico])

  const groups = def?.groups || []
  const total = def?.totalItems || 0
  const respondidos = useMemo(() => groups.flatMap((g) => g.items).filter((i) => answers[i.key]).length, [groups, answers])
  const faltas = useMemo(() => Object.values(answers).filter((a) => a.state === 'missing').length, [answers])
  const revisao = fase === groups.length
  const grupo = groups[fase]

  const ir = (n) => { setFase(n); topo.current?.scrollTo({ top: 0 }) }
  const setAns = (it, patch) => setAnswers((prev) => {
    const next = { ...prev }
    if (patch === null) { delete next[it.key]; return next }
    const ex = prev[it.key]
    const m = { key: it.key, state: patch.state ?? ex?.state ?? 'ok' }
    const obs = patch.obs !== undefined ? patch.obs : ex?.obs
    if (obs) m.obs = obs
    const value = patch.value !== undefined ? patch.value : ex?.value
    if (value) m.value = value
    next[it.key] = m
    return next
  })
  const alternarOk = (it) => (answers[it.key]?.state === 'ok' ? setAns(it, null) : setAns(it, { state: 'ok' }))
  const campo = (it, v) => (v.trim() ? setAns(it, { state: 'ok', value: v }) : setAns(it, null))
  const abrirSheet = (it) => { setSheet(it); setSheetObs(answers[it.key]?.obs || '') }
  const confirmarSheet = (state) => { setAns(sheet, { state, obs: sheetObs.trim() }); setSheet(null) }
  const restantesOk = () => grupo.items.filter((i) => !answers[i.key] && i.kind === 'check').forEach((i) => setAns(i, { state: 'ok' }))

  const enviar = async () => {
    setErr(''); setBusy(true)
    try {
      const items = groups.flatMap((g) => g.items).map((i) => answers[i.key]).filter(Boolean)
      const r = await api.sendChecklistGoa({ doctorName: medico.trim(), items, shiftLabel: def.turno })
      try { localStorage.removeItem(draftKey(dia)) } catch (e) { /* ok */ }
      setDone(r)
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  const grupoCompleto = grupo?.items.every((i) => answers[i.key])

  return (
    <div className="cg" role="dialog" aria-label="Checklist GOA">
      <header className="cg-head">
        <div className="cg-row">
          <button className="cg-ib" onClick={onClose} aria-label="Fechar"><IconX size={18} /></button>
          <div className="cg-title">
            <b>GOA <span>checklist</span></b>
            <small>{def?.dayLabel || ''}</small>
          </div>
          {def && !done && <span className="cg-count">{respondidos}/{total}</span>}
          <button className="cg-ib rel" onClick={() => setShowFoto(true)} aria-label="Registrar inconformidade com foto">📷{ncs.length > 0 && <em>{ncs.length}</em>}</button>
          <button className="cg-ib rel" onClick={() => setShowHist(true)} aria-label="Checklists anteriores">🕘{hist?.alerts?.length > 0 && <em>{hist.alerts.length}</em>}</button>
        </div>
        {def && !done && (
          <>
            <div className="cg-bar"><i className={faltas ? 'warn' : ''} style={{ width: total ? `${(respondidos / total) * 100}%` : 0 }} /></div>
            <div className="cg-chips">
              {groups.map((g, i) => {
                const feitos = g.items.filter((it) => answers[it.key]).length
                const cls = i === fase ? 'on' : feitos === g.items.length ? 'ok' : feitos ? 'part' : ''
                return <button key={g.key} className={'cg-chip ' + cls} onClick={() => ir(i)} aria-label={`Seção ${i + 1}: ${g.title}`}>{feitos === g.items.length && i !== fase ? '✓ ' : ''}{i + 1}</button>
              })}
              <button className={'cg-chip wide ' + (revisao ? 'on' : '')} onClick={() => ir(groups.length)}>Revisar</button>
            </div>
          </>
        )}
      </header>

      <main className="cg-main" ref={topo}>
        {err && <div className="login-err">{err}</div>}
        {!def && !err && <div className="small">Carregando…</div>}

        {done && (
          <div className="cg-done">
            <div className="cg-doneicon"><IconCheck size={44} /></div>
            <h2>Checklist enviado!</h2>
            <p>GOA · {medico}</p>
            <p className="small">{done.okCount} conformes{done.missingCount ? ` · ${done.missingCount} faltando` : ' · tudo conforme'}. Já aparece em checklist.mnrs.com.br.</p>
          </div>
        )}

        {def && !done && grupo && (
          <>
            {fase === 0 && def.enviadoHoje && (
              <div className="cg-note"><IconAlert size={14} /> Hoje já foi enviado às {new Date(def.enviadoHoje.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Bahia' })} por {def.enviadoHoje.doctorName}. Enviar de novo cria um novo registro.</div>
            )}
            {fase === 0 && hist && (hist.alerts.length > 0 || hist.latestObs.length > 0) && (
              <div className="cg-note">
                <b>⚠️ Atenção — do último checklist</b>
                <ul className="cg-alerts">
                  {hist.alerts.map((a) => <li key={a.key}>🚫 <b>{a.label}</b> — em falta desde {dm(a.sinceDay)} · informado por {a.reportedBy}{a.obs ? ` — ${a.obs}` : ''}</li>)}
                  {hist.latestObs.map((o, i) => <li key={i}>📝 {o.label} — <i>{o.obs}</i></li>)}
                </ul>
                <button className="cg-link warn" onClick={() => setShowHist(true)}>Ver checklists anteriores →</button>
              </div>
            )}
            {fase === 0 && ncs.length > 0 && (
              <div className="cg-box">
                <h4>📷 Inconformidades registradas ({ncs.length})</h4>
                {ncs.map((n) => (
                  <div key={n.id} className="cg-nc">
                    <button onClick={() => setLightbox(n)}><img src={n.photoUrl} alt="Inconformidade" loading="lazy" /></button>
                    <div><p>{n.description}</p><small>{dm(n.day)} {hm(n.createdAt)}{n.doctorName ? ` · ${n.doctorName}` : ''}</small></div>
                  </div>
                ))}
              </div>
            )}
            <div className="cg-sec"><h2>{grupo.title}</h2><span>seção {fase + 1}/{groups.length}</span></div>
            <div className="cg-list">
              {grupo.items.map((it) => {
                const a = answers[it.key]
                const st = a?.state
                if (it.kind !== 'check') {
                  return (
                    <div key={it.key} className={'cg-item field ' + (st || '')}>
                      <p className="cg-label">{it.label}</p>
                      <input type={it.kind === 'date' ? 'date' : 'text'} inputMode={it.kind === 'date' ? undefined : 'numeric'}
                        placeholder={it.hint || 'Preencher'} value={a?.value || ''} onChange={(e) => campo(it, e.target.value)} />
                    </div>
                  )
                }
                return (
                  <div key={it.key} className={'cg-item ' + (st || '')}>
                    <button className="cg-main-btn" onClick={() => alternarOk(it)}>
                      <span className="cg-dot">{st === 'ok' ? <IconCheck size={15} /> : st === 'missing' ? '!' : ''}</span>
                      <span className="cg-txt">
                        <span className="cg-label">{it.label}</span>
                        {a?.obs && <span className="cg-obs">Obs: {a.obs}</span>}
                        {st === 'missing' && <span className="cg-falta">Faltando</span>}
                      </span>
                    </button>
                    <button className="cg-side" onClick={() => abrirSheet(it)} aria-label="Relatar falta ou observação">＋</button>
                  </div>
                )
              })}
            </div>
            {!grupoCompleto && <button className="cg-link" onClick={restantesOk}>Marcar restantes da seção como conformes</button>}
          </>
        )}

        {def && !done && revisao && (
          <>
            <div className="cg-sec"><h2>Revisão e envio</h2></div>
            <div className="cg-stats">
              <div className="ok"><b>{respondidos - faltas}</b><span>conformes</span></div>
              <div className={faltas ? 'bad' : ''}><b>{faltas}</b><span>faltando</span></div>
            </div>
            {respondidos < total && (
              <div className="cg-note">
                Faltam responder {total - respondidos} {total - respondidos === 1 ? 'item' : 'itens'}:
                {groups.map((g, i) => ({ g, i, n: g.items.filter((it) => !answers[it.key]).length })).filter((x) => x.n).map(({ g, i, n }) => (
                  <button key={g.key} className="cg-goto" onClick={() => ir(i)}>Seção {i + 1} — {g.title} <b>{n} →</b></button>
                ))}
              </div>
            )}
            {faltas > 0 && (
              <div className="cg-box">
                <h4>Itens faltando</h4>
                <ul>{groups.flatMap((g) => g.items).filter((i) => answers[i.key]?.state === 'missing').map((i) => (
                  <li key={i.key}>🚫 <b>{i.shortLabel}</b>{answers[i.key].obs ? ` — ${answers[i.key].obs}` : ''}</li>
                ))}</ul>
              </div>
            )}
            <div className="cg-box">
              <label className="small" htmlFor="cg-medico">Enviando como</label>
              <input id="cg-medico" value={medico} onChange={(e) => setMedico(e.target.value)} placeholder="Nome do responsável" maxLength={120} />
              <p className="small">A coordenação recebe o resultado no Telegram imediatamente.</p>
            </div>
          </>
        )}
      </main>

      <footer className="cg-foot">
        {done ? (
          <button className="btn cg-big" onClick={onClose}>Fechar</button>
        ) : def && (
          <>
            {fase > 0 && <button className="btn sec cg-back" onClick={() => ir(fase - 1)}>← Voltar</button>}
            {!revisao && <button className="btn cg-big" onClick={() => ir(fase + 1)}>{fase === groups.length - 1 ? 'Revisar' : 'Próxima seção'} →</button>}
            {revisao && (
              <button className="btn cg-big" disabled={busy || respondidos < total || medico.trim().length < 3} onClick={enviar}>
                {busy ? 'Enviando…' : faltas ? `Enviar (${faltas} faltando)` : 'Enviar — tudo conforme'}
              </button>
            )}
          </>
        )}
      </footer>

      {showHist && (
        <div className="cg-over">
          <div className="cg-row cg-overhead">
            <b style={{ flex: 1 }}>Checklists anteriores — GOA {hist && <small>({hist.windowDays} dias)</small>}</b>
            <button className="cg-ib" onClick={() => setShowHist(false)} aria-label="Fechar"><IconX size={18} /></button>
          </div>
          <div className="cg-overbody">
            {!hist ? <p className="small">Carregando…</p> : hist.days.length === 0 ? <p className="small">Nenhum checklist da GOA nos últimos {hist.windowDays} dias.</p> : hist.days.map((d) => (
              <div key={d.day} className="cg-box">
                <p className="cg-hday"><b>{dm(d.day)} <span>{hm(d.createdAt)}</span></b><small>{d.doctorName}</small></p>
                {d.missingCount === 0 && d.obs.length === 0 && <p className="cg-okline">Tudo conforme ✨</p>}
                {d.missing.length > 0 && <ul className="cg-alerts bad">{d.missing.map((m) => <li key={m.key}>🚫 <b>{m.label}</b>{m.obs ? ` — ${m.obs}` : ''}</li>)}</ul>}
                {d.obs.length > 0 && <ul className="cg-alerts">{d.obs.map((o) => <li key={o.key}>📝 {o.label} — <i>{o.obs}</i></li>)}</ul>}
                {d.values.length > 0 && <small>{d.values.map((v) => `${v.label}: ${v.value}`).join(' · ')}</small>}
              </div>
            ))}
          </div>
        </div>
      )}

      {showFoto && (
        <>
          <div className="cg-scrim" onClick={() => setShowFoto(false)} />
          <div className="cg-sheet tall">
            <small>INCONFORMIDADE — GOA</small>
            <h3>Fotografe o que está fora do padrão</h3>
            <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => escolherFoto(e.target.files?.[0])} />
            <button className="cg-pick" onClick={() => fileRef.current?.click()}>
              {foto ? <><img src={foto} alt="Prévia" /><span>Trocar foto</span></> : <span>📷 Tirar / escolher foto</span>}
            </button>
            <textarea rows={3} maxLength={500} value={fotoDesc} onChange={(e) => setFotoDesc(e.target.value)} placeholder="O que a foto mostra? Ex.: cilindro de O2 com lacre rompido…" />
            {fotoErr && <div className="login-err">{fotoErr}</div>}
            <button className="btn" disabled={!foto || fotoDesc.trim().length < 3 || fotoBusy} onClick={enviarFoto}>{fotoBusy ? 'Enviando…' : 'Enviar inconformidade'}</button>
            <button className="cg-link" onClick={() => setShowFoto(false)}>Cancelar</button>
            <small>A coordenação recebe a foto no Telegram na hora. As fotos ficam visíveis na unidade por 7 dias.</small>
          </div>
        </>
      )}

      {lightbox && (
        <div className="cg-light" onClick={() => setLightbox(null)}>
          <img src={lightbox.photoUrl} alt="Inconformidade" />
          <p>{lightbox.description}</p>
          <small>{dm(lightbox.day)} {hm(lightbox.createdAt)}{lightbox.doctorName ? ` · ${lightbox.doctorName}` : ''}</small>
        </div>
      )}

      {sheet && (
        <>
          <div className="cg-scrim" onClick={() => setSheet(null)} />
          <div className="cg-sheet">
            <small>ITEM</small>
            <h3>{sheet.label}</h3>
            <textarea rows={3} maxLength={300} value={sheetObs} onChange={(e) => setSheetObs(e.target.value)}
              placeholder="Observação (ex.: lâmina 3 no almoxarifado, bateria 90%…)" />
            <button className="btn cg-bad" onClick={() => confirmarSheet('missing')}>Marcar como FALTANDO</button>
            <button className="btn sec" onClick={() => confirmarSheet('ok')}>Item OK, só registrar observação</button>
            <button className="cg-link" onClick={() => setSheet(null)}>Cancelar</button>
          </div>
        </>
      )}
    </div>
  )
}
