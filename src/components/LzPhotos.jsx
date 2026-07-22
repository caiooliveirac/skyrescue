import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/backend.js'
import { preparePhoto } from '../lib/photo.js'
import { IconCamera, IconCheck, IconX, IconAlert } from './Icons.jsx'

// Fotos do ponto de pouso — "como o local é". Quem já pousou fotografa (a
// câmera do celular abre direto pelo capture) e a foto fica no ponto, para
// quem for pousar depois reconhecer o terreno antes de chegar.
// Usado em dois lugares: dentro do modal Comunidade (linha do ponto) e ao
// tocar no marcador do ponto no mapa (LzPhotoModal).

const when = (p) => new Date(p.taken_at || p.created_at).toLocaleDateString('pt-BR')

export function LzPhotoStrip({ point, user, onChanged, autoLoad = true }) {
  const [photos, setPhotos] = useState(null) // null = carregando
  const [pending, setPending] = useState(null) // {dataUrl,width,height,bytes,takenAt}
  const [caption, setCaption] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [zoom, setZoom] = useState(null) // foto aberta em tela cheia
  const fileRef = useRef(null)

  const load = async () => {
    try { const { photos } = await api.listLzPhotos(point.ref); setPhotos(photos) }
    catch (e) { setPhotos([]); setErr(e.message || 'falha ao carregar as fotos') }
  }
  useEffect(() => { if (autoLoad) load() }, [point.ref])

  const pick = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = '' // permite escolher a mesma foto de novo
    if (!file) return
    setErr(''); setBusy(true)
    try {
      setPending(await preparePhoto(file))
      setCaption('')
    } catch (er) {
      setErr(er.message || 'não foi possível preparar a imagem')
    } finally { setBusy(false) }
  }

  const send = async () => {
    if (!pending) return
    setErr(''); setBusy(true)
    try {
      await api.addLzPhoto({
        ref: point.ref, name: point.name,
        dataUrl: pending.dataUrl, caption, width: pending.width,
        height: pending.height, takenAt: pending.takenAt,
      })
      setPending(null); setCaption('')
      await load()
      onChanged?.()
    } catch (e) {
      setErr(e.message || 'falha ao enviar a foto')
    } finally { setBusy(false) }
  }

  const remove = async (p) => {
    if (!confirm('Excluir esta foto?')) return
    setErr('')
    try { await api.deleteLzPhoto(p.id); await load(); onChanged?.() }
    catch (e) { setErr(e.message || 'falha ao excluir') }
  }

  const canDelete = (p) => user?.role === 'admin' || p.created_by === user?.id

  return (
    <div className="lzphotos">
      {photos === null && <div className="small">carregando fotos…</div>}

      {photos?.length > 0 && (
        <div className="lzphoto-grid">
          {photos.map((p) => (
            <button key={p.id} className="lzphoto-thumb" onClick={() => setZoom(p)}
              title={p.caption || `foto de ${when(p)}`}>
              <img src={api.lzPhotoUrl(p.id)} alt={p.caption || 'foto do ponto de pouso'} loading="lazy" />
              {p.caption && <span className="cap">{p.caption}</span>}
            </button>
          ))}
        </div>
      )}

      {photos?.length === 0 && !pending && (
        <div className="small">Sem foto ainda — quem conhece o local pode mostrar como ele é.</div>
      )}

      {pending && (
        <div className="lzphoto-pending">
          <img src={pending.dataUrl} alt="prévia da foto" />
          <div className="lzphoto-pending-form">
            <input type="text" value={caption} maxLength={200} onChange={(e) => setCaption(e.target.value)}
              placeholder="legenda (ex.: aproximação pelo norte, fios na cerca)" />
            <div className="row">
              <button className="btn xs" onClick={send} disabled={busy}>
                {busy ? <span className="spin" /> : <IconCheck size={12} />} Enviar foto
              </button>
              <button className="btn xs sec" onClick={() => setPending(null)} disabled={busy}>cancelar</button>
              <span className="small">{Math.round(pending.bytes / 1024)} kB · {pending.width}×{pending.height}</span>
            </div>
          </div>
        </div>
      )}

      {err && <div className="alert fail" style={{ marginTop: 8 }}><IconAlert size={15} /> {err}</div>}

      {!pending && (
        <>
          <input ref={fileRef} type="file" accept="image/*" capture="environment"
            onChange={pick} style={{ display: 'none' }} />
          <button className="btn xs ghost" onClick={() => fileRef.current?.click()} disabled={busy}
            style={{ marginTop: 8 }}>
            {busy ? <span className="spin" /> : <IconCamera size={12} />} Adicionar foto do local
          </button>
        </>
      )}

      {zoom && (
        <div className="lzphoto-full" onClick={() => setZoom(null)}>
          <img src={api.lzPhotoUrl(zoom.id)} alt={zoom.caption || 'foto do ponto de pouso'}
            onClick={(e) => e.stopPropagation()} />
          <div className="lzphoto-full-bar" onClick={(e) => e.stopPropagation()}>
            <div>
              {zoom.caption && <b>{zoom.caption}</b>}
              <div className="small">
                {when(zoom)}
                {zoom.created_by_name || zoom.created_by_username
                  ? ` · por ${zoom.created_by_name || zoom.created_by_username}` : ''}
              </div>
            </div>
            {canDelete(zoom) && (
              <button className="btn xs warn" onClick={() => { const z = zoom; setZoom(null); remove(z) }}>excluir</button>
            )}
            <button className="btn xs sec" onClick={() => setZoom(null)}><IconX size={12} /> fechar</button>
          </div>
        </div>
      )}
    </div>
  )
}

// Aberto ao tocar em QUALQUER ponto de pouso no mapa (heliponto ANAC,
// hospital, heliponto de apoio, ponto da comunidade, área do OSM): mostra o
// que se sabe do local e as fotos. `point` = {ref, name, sub}.
export function LzPhotoModal({ point, user, onClose, onChanged }) {
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3><IconCamera size={17} /> {point.name}</h3>
        {point.sub && <div className="small" style={{ marginBottom: 10 }}>{point.sub}</div>}
        <LzPhotoStrip point={point} user={user} onChanged={onChanged} />
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn sec" onClick={onClose}>Fechar</button>
        </div>
        <div className="small" style={{ marginTop: 10 }}>
          As fotos são referência da equipe e podem estar desatualizadas —
          reconhecimento visual pelo piloto continua obrigatório.
        </div>
      </div>
    </div>
  )
}
