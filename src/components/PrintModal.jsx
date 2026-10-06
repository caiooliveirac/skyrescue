import { useState } from 'react'
import { PRINT_SECTIONS, PRINT_PRESETS, PRINT_GOA, gerarPdf } from '../lib/pdf.js'
import { IconPrint, IconDownload, IconX } from './Icons.jsx'

// Escolha do que sai no PDF do caso. A seleção fica lembrada no aparelho
// (conveniência de quem imprime); "Padrão" volta ao pré-selecionado.
const KEY = 'skyrescue_print_v2' // v2: seções novas (pendências, responsáveis, trechos, intervalos)
const PADRAO = PRINT_PRESETS[0].ids
const lerSel = () => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY))
    if (Array.isArray(v)) return v.filter((id) => PRINT_SECTIONS.some((s) => s.id === id))
  } catch (e) { /* ok */ }
  return PADRAO
}

const GRUPOS = [
  { id: 'voo', title: 'Voo' },
  { id: 'paciente', title: 'Paciente' },
  { id: 'doc', title: 'Documento' },
]

// `goa`: abre já no relatório para os bombeiros (sem paciente), sem mexer na
// seleção lembrada de quem imprime o registro completo.
export default function PrintModal({ conteudo, meta, goa, onClose }) {
  const [sel, setSel] = useState(goa ? PRINT_GOA : lerSel)
  const ehGoa = PRINT_GOA.length === sel.length && PRINT_GOA.every((id) => sel.includes(id))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const salvar = (v) => { setSel(v); if (goa) return; try { localStorage.setItem(KEY, JSON.stringify(v)) } catch (e) { /* ok */ } }
  const toggle = (id) => salvar(sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id])
  const temDado = (id) => (conteudo[id] || []).length > 0
  const saem = PRINT_SECTIONS.filter((s) => sel.includes(s.id) && temDado(s.id))
  const presetAtivo = PRINT_PRESETS.find((p) => p.ids.length === sel.length && p.ids.every((id) => sel.includes(id)))?.id
  const nome = `skyrescue-${(meta.caseId || 'caso').replace(/[^\w-]+/g, '-')}${ehGoa ? '-goa' : ''}.pdf`

  // `baixar`: salva o arquivo; senão abre no visualizador de PDF do navegador.
  // A aba é aberta JÁ no clique — depois do await o navegador (Safari do
  // iPhone sobretudo) trata como pop-up e bloqueia.
  const emitir = async (baixar) => {
    setErr('')
    const w = baixar ? null : window.open('', '_blank')
    if (w) w.document.write('<p style="font:16px sans-serif;padding:24px">Gerando PDF…</p>')
    setBusy(true)
    try {
      const blob = await gerarPdf(conteudo, sel, meta)
      const url = URL.createObjectURL(blob)
      if (w) w.location.href = url
      else {
        const a = document.createElement('a')
        a.href = url; a.download = nome
        document.body.appendChild(a); a.click(); a.remove()
      }
      setTimeout(() => URL.revokeObjectURL(url), 120000)
    } catch (e) {
      if (w) w.close()
      setErr('Falha ao gerar o PDF: ' + (e.message || e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal print-modal" onClick={(e) => e.stopPropagation()}>
        <h3>
          <IconPrint size={17} /> Imprimir / PDF
          <button className="tbtn" style={{ marginLeft: 'auto' }} onClick={onClose} title="Fechar"><IconX size={14} /></button>
        </h3>

        {conteudo.pendencias?.length > 0 && (
          <div className="alert warn" style={{ marginBottom: 12 }}>
            <span>Registro com <b>{conteudo.pendencias.length} pendência{conteudo.pendencias.length > 1 ? 's' : ''}</b> de
              documentação — {sel.includes('pendencias') ? 'saem listadas no topo do PDF' : 'a seção de pendências está desmarcada'}.
              Complete o caso antes de arquivar.</span>
          </div>
        )}

        {ehGoa ? (
          <div className="alert ok" style={{ marginBottom: 12 }}>
            <span><b>Relatório para o GOA</b> — só o voo. Dados do paciente, observações livres e pendências
              internas <b>não saem</b>.</span>
          </div>
        ) : (
          <button className="btn sec print-goa" onClick={() => setSel(PRINT_GOA)}>
            Relatório para o GOA (sem dados do paciente)
          </button>
        )}

        <div className="print-presets">
          {PRINT_PRESETS.map((p) => (
            <button key={p.id} className={'print-chip' + (presetAtivo === p.id ? ' on' : '')} onClick={() => salvar(p.ids)}>{p.label}</button>
          ))}
        </div>

        {GRUPOS.map((g) => (
          <div key={g.id}>
            <h4>{g.title}</h4>
            <div className="print-list">
              {PRINT_SECTIONS.filter((s) => s.grupo === g.id).map((s) => {
                const vazio = !temDado(s.id)
                return (
                  <label key={s.id} className={'print-item' + (vazio ? ' vazio' : '')}>
                    <input type="checkbox" checked={sel.includes(s.id)} onChange={() => toggle(s.id)} />
                    <span>{s.title}</span>
                    {vazio && <small>{s.id === 'pendencias' ? 'nenhuma' : 'sem dados'}</small>}
                  </label>
                )
              })}
            </div>
          </div>
        ))}

        {err && <div className="alert fail" style={{ marginTop: 12 }}>{err}</div>}

        <div className="print-actions">
          <span className="print-count">{saem.length} {saem.length === 1 ? 'seção' : 'seções'} no PDF</span>
          <button className="btn sec" onClick={() => emitir(true)} disabled={busy || !saem.length}><IconDownload size={14} /> Baixar</button>
          <button className="btn" onClick={() => emitir(false)} disabled={busy || !saem.length}>
            {busy ? <span className="spin" /> : <IconPrint size={14} />} Gerar PDF
          </button>
        </div>
      </div>
    </div>
  )
}
