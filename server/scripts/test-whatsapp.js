// Bot do WhatsApp sem WhatsApp: exercita o que dá para exercitar sem um chip
// pareado — o texto do aviso, o parser dos comandos, a vinculação do grupo e
// dos privados pelo /vincular, e o envio (grupo + destinatários) com um socket
// falso que registra o que "mandou". Roda contra o banco de dev:
//   DATABASE_URL=postgres://localhost/skyrescue_dev BOT_LINK_CODE=abc node scripts/test-whatsapp.js
// A conexão real (pareamento, código, QR) só se testa no servidor com o chip.
process.env.BOT_LINK_CODE = process.env.BOT_LINK_CODE || 'teste-123'
const CODE = process.env.BOT_LINK_CODE

import { query, pool } from '../src/db.js'
import {
  formatAcionamento, parseCommand, normalizePhone, prettyPhone, textOf,
  broadcast, notifyAcionamento, boundGroup, activeRecipients, addRecipient, setRecipientActive,
  removeRecipient, unbindGroup, _test,
} from '../src/whatsapp.js'

let falhas = 0
const ok = (nome, cond, detalhe = '') => {
  console.log(`${cond ? '  OK  ' : ' FALHA'} ${nome}${detalhe ? ` — ${detalhe}` : ''}`)
  if (!cond) falhas++
}

// socket falso: guarda o que mandou e responde onWhatsApp como o WhatsApp faria
function fakeSocket({ exists = () => true } = {}) {
  const sent = []
  return {
    sent,
    user: { id: '5571900000000:12@s.whatsapp.net' },
    async sendMessage(jid, content) { sent.push({ jid, text: content.text }); return { key: { id: 'x' } } },
    async onWhatsApp(n) { return exists(n) ? [{ jid: `${n}@s.whatsapp.net`, exists: true }] : [] },
    async groupMetadata(jid) { return { id: jid, subject: 'Regulação GOA' } },
  }
}
const msg = (chat, text, extra = {}) => ({
  type: 'notify',
  messages: [{ key: { remoteJid: chat, fromMe: false, id: 'm1', ...extra.key }, pushName: extra.pushName || 'Fulano', message: { conversation: text } }],
})

async function main() {
  console.log('=== utilitários puros ===')
  ok('normalizePhone com máscara', normalizePhone('(71) 98161-9480') === '5571981619480')
  ok('normalizePhone com DDI', normalizePhone('+55 71 98816-1438') === '5571988161438')
  ok('normalizePhone rejeita lixo', normalizePhone('abc') === null && normalizePhone('123') === null)
  ok('prettyPhone', prettyPhone('5571981619480') === '+55 71 98161-9480', prettyPhone('5571981619480'))
  ok('parseCommand /vincular', JSON.stringify(parseCommand('/vincular abc')) === JSON.stringify({ cmd: 'vincular', arg: 'abc', prefixed: true }))
  ok('parseCommand sem barra só vale para vincular', parseCommand('vincular abc')?.cmd === 'vincular' && parseCommand('ajuda') === null)
  ok('parseCommand com @bot', parseCommand('/vincular@bot xyz')?.arg === 'xyz')
  ok('parseCommand /ajuda', parseCommand('/ajuda')?.cmd === 'ajuda')
  ok('parseCommand conversa normal é null', parseCommand('bom dia pessoal') === null && parseCommand('❌ erro') === null)
  ok('textOf desembrulha extendedText', textOf({ message: { extendedTextMessage: { text: 'oi' } } }) === 'oi')
  ok('textOf ignora mídia', textOf({ message: { imageMessage: {} } }) === '')

  const a = {
    id: 42, created_at: new Date('2026-09-10T17:32:00Z'), central: 'Salvador', medico: 'Dra. Ana', fone: '(71) 99999-1234',
    tipo: 'Trauma', detalhe: 'Ac. Moto', local_txt: 'BR-324 km 520', lat: -12.7, lon: -38.4, pin_label: 'Simões Filho',
  }
  const t = formatAcionamento(a)
  ok('aviso tem cabeçalho e número', t.includes('ACIONAMENTO AEROMÉDICO') && t.includes('#42'))
  ok('aviso tem hora local (Bahia = UTC-3)', t.includes('10/09') && t.includes('14:32'), t.split('\n')[1])
  ok('aviso tem central, médico e contato clicável', t.includes('SAMU Salvador') && t.includes('Dra. Ana') && t.includes('wa.me/5571999991234'))
  ok('aviso tem tipo com detalhe e local', t.includes('Trauma — Ac. Moto') && t.includes('BR-324 km 520'))
  ok('aviso tem link do Maps e rótulo do pino', t.includes('maps.google.com/?q=-12.70000,-38.40000') && t.includes('Simões Filho'))
  const t2 = formatAcionamento({ ...a, lat: null, lon: null, pin_label: null, detalhe: null })
  ok('sem pino não há link', !t2.includes('maps.google.com') && t2.includes('*Tipo:* Trauma\n'))

  console.log('\n=== vinculação pelo /vincular ===')
  await query('DELETE FROM wa_chat')
  await query(`DELETE FROM wa_recipient WHERE phone LIKE '5599%'`)
  const s = fakeSocket()
  _test.setSocket(s)

  await _test.onMessages(msg('120363@g.us', '/vincular errado', { key: { participant: '5599111111111@s.whatsapp.net' } }))
  ok('código errado não vincula', (await boundGroup()) === null && s.sent.at(-1).text.includes('inválido'))

  await _test.onMessages(msg('120363@g.us', `/vincular ${CODE}`, { key: { participant: '5599111111111@s.whatsapp.net' }, pushName: 'Felipe' }))
  const g = await boundGroup()
  ok('grupo vinculado com título e autor', g?.jid === '120363@g.us' && g.title === 'Regulação GOA' && g.linked_by === 'Felipe', JSON.stringify(g))
  ok('bot confirmou no grupo', s.sent.at(-1).jid === '120363@g.us' && s.sent.at(-1).text.includes('✅'))

  await _test.onMessages(msg('120363@g.us', 'vincular ' + CODE))
  ok('sem barra também vincula (idempotente)', (await boundGroup())?.jid === '120363@g.us')

  await _test.onMessages(msg('5599922222222@s.whatsapp.net', `/vincular ${CODE}`, { pushName: 'Dr. Novo' }))
  let rs = await activeRecipients()
  ok('privado com código entra na lista', rs.some((r) => r.phone === '5599922222222' && r.name === 'Dr. Novo' && r.active))
  ok('bot confirmou no privado', s.sent.at(-1).jid === '5599922222222@s.whatsapp.net')

  await _test.onMessages(msg('9999@lid', `/vincular ${CODE}`, { key: { remoteJidAlt: '5599333333333@s.whatsapp.net' }, pushName: 'LID' }))
  rs = await activeRecipients()
  ok('privado por LID usa o remoteJidAlt', rs.some((r) => r.phone === '5599333333333'))

  await _test.onMessages(msg('8888@lid', `/vincular ${CODE}`, { pushName: 'Sem número' }))
  ok('LID sem alternativa avisa que não identificou', s.sent.at(-1).text.includes('Não consegui identificar'))

  await _test.onMessages(msg('120363@g.us', '/ajuda'))
  ok('/ajuda responde', s.sent.at(-1).text.includes('bot do acionamento'))
  const before = s.sent.length
  await _test.onMessages(msg('120363@g.us', 'bom dia, alguém viu o piloto?'))
  await _test.onMessages({ type: 'append', messages: [{ key: { remoteJid: '120363@g.us' }, message: { conversation: '/ajuda' } }] })
  ok('conversa normal e histórico não geram resposta', s.sent.length === before)

  console.log('\n=== envio: grupo + destinatários ===')
  // deixa só os fictícios ativos, para o teste não depender dos números reais do seed
  await query(`UPDATE wa_recipient SET active = FALSE WHERE phone NOT LIKE '5599%'`)
  await removeRecipient((await activeRecipients()).find((r) => r.phone === '5599333333333').id)
  const s2 = fakeSocket({ exists: (n) => n !== '5599922222222' })   // este só existe sem o 9
  _test.setSocket(s2)
  const r = await broadcast('teste')
  ok('status ok quando tudo chega', r.status === 'ok', JSON.stringify(r))
  ok('mandou ao grupo', s2.sent.some((x) => x.jid === '120363@g.us' && x.text === 'teste'))
  ok('número BR sem o nono dígito no WhatsApp cai no formato antigo', s2.sent.some((x) => x.jid === '559922222222@s.whatsapp.net'), s2.sent.map((x) => x.jid).join(','))
  ok('inativos não recebem', !s2.sent.some((x) => x.jid.startsWith('5571')))

  const s3 = fakeSocket()
  s3.sendMessage = async (jid, c) => { if (jid.endsWith('@g.us')) throw new Error('grupo sumiu'); s3.sent.push({ jid, text: c.text }) }
  _test.setSocket(s3)
  const r2 = await broadcast('teste 2')
  ok('falha parcial vira "parcial" com detalhe', r2.status === 'parcial' && r2.detail.group === false && r2.detail['5599922222222'] === true, JSON.stringify(r2))

  const { rows } = await query(
    `INSERT INTO acionamento (central, medico, fone, tipo, local_txt) VALUES ('Salvador','Dr. T','71999990000','IAM','Av. Paralela') RETURNING *`
  )
  const s4 = fakeSocket(); _test.setSocket(s4)
  const r3 = await notifyAcionamento(rows[0])
  const saved = (await query('SELECT wa_status, wa_detail, wa_sent_at FROM acionamento WHERE id = $1', [rows[0].id])).rows[0]
  ok('notifyAcionamento grava o resultado na linha', r3.status === 'ok' && saved.wa_status === 'ok' && saved.wa_sent_at && saved.wa_detail.group === true, JSON.stringify(saved))
  ok('e o texto enviado é o aviso formatado', s4.sent[0].text.includes(`#${rows[0].id}`) && s4.sent[0].text.includes('Av. Paralela'))

  _test.setSocket(null)
  const r4 = await broadcast('x')
  ok('sem socket: "desconectado", sem lançar', r4.status === 'desconectado')

  console.log('\n=== destinatários pelo painel ===')
  const novo = await addRecipient('(71) 9 8888-7777', 'Plantão')
  ok('addRecipient normaliza', novo.phone === '5571988887777' && novo.active)
  const off = await setRecipientActive(novo.id, false)
  ok('setRecipientActive', off.active === false)
  ok('removeRecipient', (await removeRecipient(novo.id)) === true && (await removeRecipient(novo.id)) === false)
  let err = null
  try { await addRecipient('12') } catch (e) { err = e }
  ok('número inválido lança', err != null)
  await unbindGroup()
  ok('unbindGroup', (await boundGroup()) === null)

  // limpeza: some com os fictícios e reativa os reais do seed
  await query(`DELETE FROM wa_recipient WHERE phone LIKE '5599%'`)
  await query(`UPDATE wa_recipient SET active = TRUE WHERE phone NOT LIKE '5599%'`)
  await query('DELETE FROM acionamento WHERE id = $1', [rows[0].id])
  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo certo.')
  await pool.end()
  process.exit(falhas ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
