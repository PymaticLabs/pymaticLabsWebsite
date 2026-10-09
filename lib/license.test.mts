import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import {
  LICENSES_PUBLIC_KEY,
  LicenseError,
  addMonths,
  canonical,
  formatLicenseId,
  licenseFileName,
  rawPublicKey,
  signLicense,
  verifyLicense,
  type LicenseData,
} from './license.ts'

// La licencia interna del cerebro de PymaticLabs, tal cual la escribio firmar_licencia.py el
// 06-10-2026 (licencia.cerebro-licencia en la raiz de cerebro-pymaticlabs). Si su firma verifica
// con canonical(), los bytes que firmamos son los mismos que firma Python.
const REAL_LICENSE = `{
  "formato": 1,
  "licencia": {
    "id": "PML-LIC-2026-0002",
    "cliente": "PymaticLabs",
    "nif": "B88781745",
    "modalidad": "interna",
    "equipo": true,
    "emitida": "2026-10-06",
    "soporte_hasta": "2030-10-06"
  },
  "firma": "nbnXR7QhJ8pkzDxdy2Rs/DXhuu+xAoJS5g9TypwXcrZn+CBt+yTUrrgGmbZk5DZil9/noOYVSd+wydZbQ4LADQ=="
}
`

function testKey() {
  const { privateKey } = generateKeyPairSync('ed25519')
  const der = privateKey.export({ format: 'der', type: 'pkcs8' })
  return { seed: der.subarray(der.length - 32).toString('base64'), publicKey: rawPublicKey(privateKey) }
}

const sample: LicenseData = {
  id: 'PML-LIC-2026-0007',
  cliente: 'Carpintería Muñoz, S.L. "Taller"',
  nif: 'ESB12345678',
  modalidad: 'hazlo-tu',
  equipo: false,
  emitida: '2026-10-09',
  soporte_hasta: '2026-10-09',
}

test('la licencia real firmada con Python verifica con la publica de licencias.pub', () => {
  const data = verifyLicense(REAL_LICENSE, LICENSES_PUBLIC_KEY)
  assert.equal(data.id, 'PML-LIC-2026-0002')
})

test('el fichero que escribimos es identico al de firmar_licencia.py', () => {
  const doc = JSON.parse(REAL_LICENSE)
  const { formato, licencia, firma } = doc
  const rewritten = JSON.stringify({ formato, licencia, firma }, null, 2) + '\n'
  assert.equal(rewritten, REAL_LICENSE)
})

test('canonical ordena las claves, sin espacios y con el texto no ASCII tal cual', () => {
  assert.equal(
    canonical(sample).toString('utf-8'),
    '{"cliente":"Carpintería Muñoz, S.L. \\"Taller\\"","emitida":"2026-10-09","equipo":false,' +
      '"id":"PML-LIC-2026-0007","modalidad":"hazlo-tu","nif":"ESB12345678","soporte_hasta":"2026-10-09"}'
  )
})

test('firma y verifica una licencia con una clave de prueba', () => {
  const { seed, publicKey } = testKey()
  const { text, fileName } = signLicense(sample, seed, publicKey)
  assert.deepEqual(verifyLicense(text, publicKey), sample)
  assert.equal(fileName, 'licencia-carpinteria-munoz-s-l-taller.cerebro-licencia')
  assert.ok(text.endsWith('}\n'))
})

test('una licencia tocada despues de firmar no verifica', () => {
  const { seed, publicKey } = testKey()
  const { text } = signLicense(sample, seed, publicKey)
  assert.throws(() => verifyLicense(text.replace('"equipo": false', '"equipo": true'), publicKey), LicenseError)
})

test('no firma con una privada que no es la de licencias.pub', () => {
  const { seed } = testKey()
  assert.throws(() => signLicense(sample, seed), /no es la de licencias.pub/)
})

test('rechaza campos que licencia.py no acepta', () => {
  const { seed, publicKey } = testKey()
  assert.throws(() => signLicense({ ...sample, nif: ' ' }, seed, publicKey), LicenseError)
  assert.throws(() => signLicense({ ...sample, id: 'PML-LIC-26-1' }, seed, publicKey), LicenseError)
  assert.throws(() => signLicense({ ...sample, soporte_hasta: '2026-10-08' }, seed, publicKey), LicenseError)
  assert.throws(() => signLicense({ ...sample, emitida: '2026-02-30' }, seed, publicKey), LicenseError)
})

test('ids y fechas', () => {
  assert.equal(formatLicenseId(2026, 7), 'PML-LIC-2026-0007')
  assert.throws(() => formatLicenseId(2026, 10000), LicenseError)
  assert.equal(addMonths('2026-10-09', 3), '2027-01-09')
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28')
  assert.equal(licenseFileName('  '), 'licencia-cliente.cerebro-licencia')
})
