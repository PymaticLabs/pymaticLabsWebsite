import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createFakeDelivery } from './delivery/container.ts'
import { CONTACT_LIMIT, CONTACT_MAX, handleContact, type ContactMessage } from '../app/api/contact/handle.ts'

// El formulario de contacto: solo desde la propia web, la trampa para robots (que contesta que si sin
// mandar nada), la validacion de siempre (con los topes del formulario) y un limite por IP que solo
// cuenta lo que se manda.

const BODY = { name: 'Ana Gil', email: 'ana@empresa.es', company: '', phone: '', interest: 'acompanado', message: 'Queremos montar el cerebro en la gestoría.', locale: 'es', website: '' }

function setup({ zone = true } = {}) {
  const sent: ContactMessage[] = []
  const delivery = zone ? createFakeDelivery() : null
  const deps = { delivery: () => delivery, send: async (m: ContactMessage) => void sent.push(m) }
  const post = (body: unknown, { sameOrigin = true, ip = '203.0.113.9' as string | null } = {}) => handleContact(deps, { body, sameOrigin, ip })
  return { sent, post }
}

test('contacto: un mensaje bueno se manda, sin el campo trampa', async () => {
  const { sent, post } = setup()
  assert.deepEqual(await post(BODY), { status: 200, body: { success: true } })
  assert.equal(sent.length, 1)
  assert.equal(sent[0].email, 'ana@empresa.es')
  assert.equal('website' in sent[0], false)
})

test('contacto: desde otra web, 403 y nada mandado', async () => {
  const { sent, post } = setup()
  assert.equal((await post(BODY, { sameOrigin: false })).status, 403)
  assert.equal(sent.length, 0)
})

test('contacto: la trampa rellena contesta que si y no manda nada (y lo deja en el registro, sin datos)', async (t) => {
  const warn = t.mock.method(console, 'warn', () => {})
  const { sent, post } = setup()
  assert.deepEqual(await post({ ...BODY, website: 'https://spam.example' }), { status: 200, body: { success: true } })
  // Aunque lo demas no valga: el robot no aprende que esta mal.
  assert.deepEqual(await post({ website: 'x' }), { status: 200, body: { success: true } })
  assert.equal(sent.length, 0)
  assert.equal(warn.mock.callCount(), 2)
  assert.deepEqual(warn.mock.calls[0].arguments, ['[contacto] trampa rellena: no se manda'])
})

test('contacto: lo que no valida, 400', async () => {
  const { sent, post } = setup()
  assert.equal((await post({ ...BODY, message: 'corto' })).status, 400)
  assert.equal((await post({ ...BODY, interest: 'otra-cosa' })).status, 400)
  assert.equal((await post(null)).status, 400)
  assert.equal(sent.length, 0)
})

test('contacto: mas de 5 envios por hora desde una IP, 429; otra IP sigue pudiendo', async () => {
  const { sent, post } = setup()
  for (let i = 0; i < CONTACT_LIMIT.hits; i++) assert.equal((await post(BODY)).status, 200)
  assert.deepEqual(await post(BODY), { status: 429, body: { error: 'demasiados intentos', code: 'rate_limited' } })
  // La misma IP como IPv4 dentro de IPv6 cuenta igual.
  assert.equal((await post(BODY, { ip: '::ffff:203.0.113.9' })).status, 429)
  assert.equal((await post(BODY, { ip: '198.51.100.4' })).status, 200)
  assert.equal(sent.length, CONTACT_LIMIT.hits + 1)
})

test('contacto: ni lo que no vale ni la trampa gastan cupo: tras cinco envios malos, el bueno sale', async (t) => {
  t.mock.method(console, 'warn', () => {})
  const { sent, post } = setup()
  // Lo que el navegador dejaba pasar y el servidor no: un correo sin dominio de primer nivel, un mensaje
  // que solo llega a 20 con los espacios de los lados y campos con un caracter de mas.
  const bad = [
    { ...BODY, email: 'ana@empresa' },
    { ...BODY, message: '  Hola, llamadme ya.  ' },
    { ...BODY, message: 'x'.repeat(CONTACT_MAX.message + 1) },
    { ...BODY, name: 'A'.repeat(CONTACT_MAX.name + 1) },
    { ...BODY, phone: '6'.repeat(CONTACT_MAX.phone + 1) },
  ]
  assert.equal(bad.length, CONTACT_LIMIT.hits)
  for (const body of bad) assert.equal((await post(body)).status, 400)
  assert.equal((await post({ ...BODY, website: 'x' })).status, 200)
  assert.deepEqual(await post(BODY), { status: 200, body: { success: true } })
  assert.equal(sent.length, 1)
  // Lo que se manda si cuenta: hasta el limite.
  for (let i = 1; i < CONTACT_LIMIT.hits; i++) assert.equal((await post(BODY)).status, 200)
  assert.equal((await post(BODY)).status, 429)
})

test('contacto: el formulario tiene los mismos topes que el servidor (maxLength)', async () => {
  const form = readFileSync(new URL('../components/contact-form.tsx', import.meta.url), 'utf-8')
  for (const [field, max] of Object.entries(CONTACT_MAX)) {
    // El elemento con ese id, hasta su cierre.
    const tag = form.match(new RegExp(`id="${field}"[\\s\\S]*?/>`))?.[0] ?? ''
    assert.match(tag, new RegExp(`maxLength=\\{${max}\\}`), field)
  }
  // Y el servidor acepta justo el tope (lo que deja escribir el navegador).
  const { sent, post } = setup({ zone: false })
  const full = {
    ...BODY,
    name: 'A'.repeat(CONTACT_MAX.name),
    email: `${'a'.repeat(CONTACT_MAX.email - '@empresa.es'.length)}@empresa.es`,
    company: 'B'.repeat(CONTACT_MAX.company),
    phone: '6'.repeat(CONTACT_MAX.phone),
    message: 'x'.repeat(CONTACT_MAX.message),
  }
  assert.equal(full.email.length, CONTACT_MAX.email)
  assert.equal((await post(full)).status, 200)
  assert.equal(sent.length, 1)
})

test('contacto: sin la zona montada no hay donde contar, y no se limita', async () => {
  const { sent, post } = setup({ zone: false })
  for (let i = 0; i < CONTACT_LIMIT.hits + 2; i++) assert.equal((await post(BODY)).status, 200)
  assert.equal(sent.length, CONTACT_LIMIT.hits + 2)
})

test('contacto: si el correo falla, 500 (el formulario enseña su error)', async (t) => {
  t.mock.method(console, 'error', () => {})
  const delivery = createFakeDelivery()
  const res = await handleContact(
    { delivery: () => delivery, send: async () => Promise.reject(new Error('cuota agotada')) },
    { body: BODY, sameOrigin: true, ip: '203.0.113.9' }
  )
  assert.equal(res.status, 500)
})

test('contacto: si la entrega no se puede montar (una variable mal puesta), el mensaje sale igual', async (t) => {
  t.mock.method(console, 'error', () => {})
  const sent: ContactMessage[] = []
  const res = await handleContact(
    {
      delivery: () => {
        throw new Error('DELIVERY_MODE=fake no vale en produccion')
      },
      send: async (m) => void sent.push(m),
    },
    { body: BODY, sameOrigin: true, ip: '203.0.113.9' }
  )
  assert.deepEqual(res, { status: 200, body: { success: true } })
  assert.equal(sent.length, 1)
})

test('contacto: si la base de datos falla o no contesta, el mensaje sale igual (sin esperar a que se agote la funcion)', async (t) => {
  t.mock.method(console, 'error', () => {})
  for (const hit of [() => Promise.reject(new Error('base caida')), () => new Promise<never>(() => {})]) {
    const delivery = createFakeDelivery()
    delivery.repo.hitRateLimit = hit as typeof delivery.repo.hitRateLimit
    const sent: ContactMessage[] = []
    const started = Date.now()
    const res = await handleContact({ delivery: () => delivery, send: async (m) => void sent.push(m), limitTimeoutMs: 50 }, { body: BODY, sameOrigin: true, ip: '203.0.113.9' })
    assert.deepEqual(res, { status: 200, body: { success: true } })
    assert.equal(sent.length, 1)
    assert.ok(Date.now() - started < 2000)
  }
})
