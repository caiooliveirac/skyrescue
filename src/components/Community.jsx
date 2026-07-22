import { useState } from 'react'
import { api } from '../lib/backend.js'
import { CoordReadout } from './Results.jsx'
import { IconUsers, IconTarget, IconCheck, IconX, IconAlert, IconPin, IconCamera } from './Icons.jsx'
import { LzPhotoStrip } from './LzPhotos.jsx'

const STATUS_BADGE = {
  pendente: ['warn', 'aguardando validação'],
  aprovado: ['ok', 'validado'],
  rejeitado: ['fail', 'rejeitado'],
}

// Pontos de pouso da comunidade: usuário logado sugere um local onde a
// equipe já pousou (campo, praça…); fica âmbar no mapa até um admin
// validar — só então entra na base com a cor padrão e no ranking de LZ.
export default function CommunityModal({ user, points, draft, onDraftDone, onClose, onPickOnMap, refresh, onFocus }) {
  const isAdmin = user?.role === 'admin'
  const [name, setName] = useState('')
  const [municipio, setMunicipio] = useState('')
  const [description, setDescription] = useState('')
  // coordenadas editáveis à mão — o clique no mapa só preenche o ponto de partida
  const [lat, setLat] = useState(draft ? draft.lat.toFixed(6) : '')
  const [lon, setLon] = useState(draft ? draft.lon.toFixed(6) : '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [flash, setFlash] = useState('')
  // ponto recém-criado: abre a câmera logo em seguida, enquanto a equipe ainda
  // está no local — é o momento em que a foto existe para ser tirada
  const [justCreated, setJustCreated] = useState(null)
  const [openPhotos, setOpenPhotos] = useState(null) // id do ponto com as fotos expandidas

  const num = (s) => Number(String(s).trim().replace(',', '.'))

  const submit = async () => {
    setErr('')
    const la = num(lat), lo = num(lon)
    if (!name.trim()) { setErr('Dê um nome ao local (ex.: Campo do Bela Vista, Vera Cruz).'); return }
    if (!Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) {
      setErr('Coordenadas inválidas — use graus decimais (ex.: -12.9822, -38.4813).'); return
    }
    setBusy(true)
    try {
      const created = await api.createCommunityLz({ name, municipio, description, lat: la, lon: lo })
      await refresh()
      setJustCreated({ id: created.id, name: name.trim(), municipio, description, status: 'pendente' })
      setOpenPhotos(created.id)
      setName(''); setMunicipio(''); setDescription(''); setLat(''); setLon('')
      onDraftDone?.()
      setFlash('Sugestão enviada! Ela aparece no mapa em âmbar até o admin validar.')
      setTimeout(() => setFlash(''), 6000)
    } catch (e) {
      setErr(e.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  const review = async (p, status) => {
    setErr('')
    try {
      await api.updateCommunityLz(p.id, { status })
      await refresh()
    } catch (e) { setErr(e.message || String(e)) }
  }

  const remove = async (p) => {
    if (!confirm(`Excluir o ponto “${p.name}”?`)) return
    setErr('')
    try {
      await api.deleteCommunityLz(p.id)
      await refresh()
    } catch (e) { setErr(e.message || String(e)) }
  }

  const canDelete = (p) => isAdmin || (p.created_by === user?.id && p.status === 'pendente')
  const showForm = draft != null

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3><IconUsers size={17} /> Pontos de pouso da comunidade</h3>
        <div className="small" style={{ marginBottom: 10 }}>
          Locais onde a equipe já pousou (campo de futebol, praça, pátio…). A sugestão fica
          em <b style={{ color: 'var(--warn)' }}>âmbar</b> no mapa até o admin validar — validada,
          entra na base com a cor padrão e passa a ser sugerida como área de pouso.
        </div>

        {!showForm && (
          <div className="row" style={{ marginBottom: 12 }}>
            <button className="btn" onClick={onPickOnMap}>
              <IconPin size={14} /> Sugerir ponto — clicar no local no mapa
            </button>
          </div>
        )}

        {showForm && (
          <div className="card" style={{ marginBottom: 12 }}>
            <h2 style={{ fontSize: 14 }}><IconTarget size={14} /> Nova sugestão</h2>
            <div className="field">
              <label>Nome do local</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)}
                placeholder="ex.: Campo de futebol de Vera Cruz" autoFocus />
            </div>
            <div className="field">
              <label>Município / bairro</label>
              <input type="text" value={municipio} onChange={(e) => setMunicipio(e.target.value)}
                placeholder="ex.: Candeias" />
            </div>
            <div className="row">
              <div className="field" style={{ flex: 1 }}>
                <label>Latitude</label>
                <input type="text" className="mono" value={lat} onChange={(e) => setLat(e.target.value)} placeholder="-12.9822" />
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label>Longitude</label>
                <input type="text" className="mono" value={lon} onChange={(e) => setLon(e.target.value)} placeholder="-38.4813" />
              </div>
            </div>
            <div className="field">
              <label>Observação operacional (acesso, obstáculos, histórico de pousos)</label>
              <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)}
                placeholder="ex.: pousamos aqui em 2025; fios na lateral norte; acesso pela BA-001" style={{ width: '100%' }} />
            </div>
            <div className="row">
              <button className="btn" onClick={submit} disabled={busy}>
                {busy ? <span className="spin" /> : <IconCheck size={14} />} Enviar sugestão
              </button>
              <button className="btn sec" onClick={() => onDraftDone?.()}>Cancelar</button>
            </div>
          </div>
        )}

        {flash && <div className="alert ok" style={{ marginBottom: 10 }}><IconCheck size={15} /> {flash}</div>}

        {justCreated && (
          <div className="card" style={{ marginBottom: 12 }}>
            <h2 style={{ fontSize: 14 }}><IconCamera size={14} /> Foto de “{justCreated.name}”</h2>
            <div className="small" style={{ marginBottom: 6 }}>
              Fotografe o local agora: quem for pousar depois vê como ele é antes de chegar.
            </div>
            <LzPhotoStrip point={{ ref: `com/${justCreated.id}`, name: justCreated.name }} user={user} onChanged={refresh} />
            <div className="row" style={{ marginTop: 10 }}>
              <button className="btn xs sec" onClick={() => setJustCreated(null)}>pronto</button>
            </div>
          </div>
        )}
        {err && <div className="alert fail" style={{ marginBottom: 10 }}><IconAlert size={15} /> {err}</div>}

        {!points.length && <div className="small">Nenhum ponto sugerido ainda — seja o primeiro!</div>}
        {points.map((p) => {
          const [bcls, blabel] = STATUS_BADGE[p.status] || ['', p.status]
          const author = p.created_by_name || p.created_by_username
          const shown = openPhotos === p.id
          return (
            <div key={p.id} className="lzrow" style={{ cursor: 'default', flexWrap: 'wrap' }}>
              <div className={'lztile ' + (p.status === 'aprovado' ? 'suit-valid' : p.status === 'pendente' ? 'suit-avaliar' : 'suit-restrita')}>
                <IconUsers size={20} />
              </div>
              <div className="lzmain">
                <div className="n">
                  {p.name} {p.municipio && <span className="type">{p.municipio}</span>}
                  <span className={'badge ' + bcls}>{blabel}</span>
                </div>
                <div className="m">
                  {author ? `sugerido por ${author} · ` : ''}{new Date(p.created_at).toLocaleDateString('pt-BR')}
                  {p.description ? ` · “${p.description}”` : ''}
                  {p.status === 'rejeitado' && p.review_note ? ` · motivo: ${p.review_note}` : ''}
                </div>
                <div onClick={(e) => e.stopPropagation()}>
                  <CoordReadout point={p} />
                </div>
              </div>
              <button className="btn xs sec" onClick={() => onFocus(p)} title="Centralizar no mapa">mapa</button>
              <button className={'btn xs ' + (shown ? '' : 'sec')} onClick={() => setOpenPhotos(shown ? null : p.id)}
                title="Fotos do local">
                <IconCamera size={12} /> {p.photo_count > 0 ? p.photo_count : ''}
              </button>
              {isAdmin && p.status === 'pendente' && (
                <>
                  <button className="btn xs" onClick={() => review(p, 'aprovado')} title="Validar: entra na base com a cor padrão">
                    <IconCheck size={12} /> validar
                  </button>
                  <button className="btn xs warn" onClick={() => review(p, 'rejeitado')}>rejeitar</button>
                </>
              )}
              {isAdmin && p.status === 'rejeitado' && (
                <button className="btn xs sec" onClick={() => review(p, 'pendente')} title="Voltar para a fila de validação">reabrir</button>
              )}
              {canDelete(p) && (
                <button className="btn xs warn" onClick={() => remove(p)} title="Excluir"><IconX size={12} /></button>
              )}
              {shown && (
                <div style={{ flexBasis: '100%', marginTop: 4 }}>
                  <LzPhotoStrip point={{ ref: `com/${p.id}`, name: p.name }} user={user} onChanged={refresh} />
                </div>
              )}
            </div>
          )
        })}

        <div className="small" style={{ marginTop: 10 }}>
          Pontos da comunidade são referências operacionais da equipe — <b>não</b> são helipontos
          homologados. Reconhecimento visual pelo piloto continua obrigatório.
        </div>
      </div>
    </div>
  )
}
