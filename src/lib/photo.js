// Preparo da foto do ponto de pouso no próprio navegador: a imagem sai da
// câmera do celular com 3–8 MB e não pode subir assim — o nginx da produção
// aceita 1 MB de corpo por padrão e base64 ainda infla o tamanho em ~33%.
// Aqui a foto é reduzida e recomprimida até caber com folga (<500 kB), o que
// dispensa mexer na configuração do servidor e economiza dado do 4G a bordo.

const MAX_PX = 1280          // lado maior — suficiente para reconhecer o terreno
const TARGET_BYTES = 480_000 // limite do JPEG final (antes do base64)
const QUALITIES = [0.82, 0.72, 0.62, 0.5]

// decodifica respeitando a orientação EXIF (foto de celular deitada)
async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }) }
    catch (e) { /* Safari antigo: cai no <img> */ }
  }
  const url = URL.createObjectURL(file)
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('não foi possível ler a imagem'))
      img.src = url
    })
  } finally {
    // o canvas já copiou os pixels quando esta promessa resolve
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}

const draw = (src, w, h) => {
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  c.getContext('2d').drawImage(src, 0, 0, w, h)
  return c
}

const dataUrlBytes = (u) => Math.floor((u.length - (u.indexOf(',') + 1)) * 3 / 4)

// File (câmera ou galeria) -> { dataUrl JPEG, width, height, bytes, takenAt }
export async function preparePhoto(file) {
  if (!file || !/^image\//.test(file.type)) throw new Error('selecione uma imagem')
  const src = await decode(file)
  const sw = src.width, sh = src.height
  if (!sw || !sh) throw new Error('imagem sem dimensões válidas')

  let scale = Math.min(1, MAX_PX / Math.max(sw, sh))
  let out = null
  // reduz a qualidade primeiro; só encolhe mais se ainda não couber (foto de
  // vegetação/telhado tem muito detalhe e resiste à compressão)
  for (let round = 0; round < 3 && !out; round++) {
    const w = Math.max(1, Math.round(sw * scale)), h = Math.max(1, Math.round(sh * scale))
    const canvas = draw(src, w, h)
    for (const q of QUALITIES) {
      const dataUrl = canvas.toDataURL('image/jpeg', q)
      const bytes = dataUrlBytes(dataUrl)
      if (bytes <= TARGET_BYTES || (q === QUALITIES[QUALITIES.length - 1] && round === 2)) {
        out = { dataUrl, width: w, height: h, bytes }
        break
      }
    }
    scale *= 0.75
  }
  src.close?.()
  if (out.bytes > 2 * 1024 * 1024) throw new Error('não foi possível reduzir a imagem o bastante')
  return { ...out, takenAt: file.lastModified || null }
}
