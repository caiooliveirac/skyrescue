// node scripts/test-maps-link.js — valida o parser de links do Google Maps
import assert from 'node:assert'
import { parseMapsLink } from '../../src/lib/api.js'

// link completo de lugar: pin !3d!4d vence o @ do viewport
let r = parseMapsLink('https://www.google.com/maps/place/Hospital+Geral+do+Estado/@-12.9946,-38.4907,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d-12.9949441!4d-38.4887338!16s')
assert.ok(Math.abs(r.lat - -12.9949441) < 1e-6 && Math.abs(r.lon - -38.4887338) < 1e-6)
assert.equal(r.name, 'Hospital Geral do Estado')

// ?q=lat,lon
r = parseMapsLink('https://maps.google.com/?q=-12.8522,-38.3518')
assert.ok(Math.abs(r.lat - -12.8522) < 1e-6 && Math.abs(r.lon - -38.3518) < 1e-6)

// só viewport @
r = parseMapsLink('https://www.google.com/maps/@-12.8976,-38.3895,15z')
assert.ok(Math.abs(r.lat - -12.8976) < 1e-6)

// "lat, lon" colado
r = parseMapsLink('-12.7805, -38.4023')
assert.ok(Math.abs(r.lon - -38.4023) < 1e-6)

// nome com URL-encoding
r = parseMapsLink('https://www.google.com/maps/place/Hospital%20Municipal%20de%20Salvador/@-12.89,-38.38,17z')
assert.equal(r.name, 'Hospital Municipal de Salvador')

// lixo não vira coordenada
assert.equal(parseMapsLink('https://maps.app.goo.gl/AbCdEf123'), null)
assert.equal(parseMapsLink('texto qualquer'), null)
assert.equal(parseMapsLink('?q=999.0,-38.5'), null) // fora de faixa

console.log('OK — parseMapsLink')
