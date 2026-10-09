// La licencia del Cerebro Digital, firmada en la funcion de entrega.
//
// Reproduce byte a byte esqueleto/scripts/licencia.py y firmar_licencia.py del repo
// cerebro-pymaticlabs: el cerebro la comprueba sin internet con esqueleto/firmas/licencias.pub.
// Si cambia el formato alli, cambia aqui. lib/license.test.ts lo comprueba contra una licencia
// real firmada por firmar_licencia.py.
//
// Sin imports con alias (@/...): los tests corren con `node --test`, sin compilar.

import { createPrivateKey, createPublicKey, sign, verify, type KeyObject } from 'node:crypto'

export const LICENSE_FORMAT = 1
export const LICENSE_EXTENSION = '.cerebro-licencia'

/** La publica de esqueleto/firmas/licencias.pub (creada el 05-10-2026). */
export const LICENSES_PUBLIC_KEY = 'BJindrRRqkm0oi++DhofPfFLr5awrwyMTLnuqA/HvIc='

export const LICENSE_MODALITIES = ['hazlo-tu', 'acompanado', 'a-medida', 'demo', 'interna'] as const
export type LicenseModality = (typeof LICENSE_MODALITIES)[number]

export interface LicenseData {
  id: string
  cliente: string
  nif: string
  modalidad: LicenseModality
  equipo: boolean
  emitida: string // AAAA-MM-DD
  soporte_hasta: string // AAAA-MM-DD, incluido
}

export interface LicenseDocument {
  formato: number
  licencia: LicenseData
  firma: string
}

const ID_RE = /^PML-LIC-(\d{4})-(\d{4})$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// Cabecera DER de una clave privada Ed25519 en PKCS#8: va delante de la semilla de 32 bytes.
const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex')
const SPKI_ED25519_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')

export class LicenseError extends Error {}

/**
 * canonico() de licencia.py: json.dumps(sort_keys=True, separators=(",", ":"), ensure_ascii=False)
 * en UTF-8. Para objetos planos de textos y booleanos, JSON.stringify escapa igual que Python
 * (comillas, barra invertida y controles; el resto va tal cual).
 */
export function canonical(license: LicenseData): Buffer {
  const sorted = Object.fromEntries(
    Object.entries(license).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  )
  return Buffer.from(JSON.stringify(sorted), 'utf-8')
}

/** El fichero: json.dumps(ensure_ascii=False, indent=2) + "\n", con el orden de firmar_licencia.py. */
export function serializeLicense(doc: LicenseDocument): string {
  const ordered = {
    formato: doc.formato,
    licencia: {
      id: doc.licencia.id,
      cliente: doc.licencia.cliente,
      nif: doc.licencia.nif,
      modalidad: doc.licencia.modalidad,
      equipo: doc.licencia.equipo,
      emitida: doc.licencia.emitida,
      soporte_hasta: doc.licencia.soporte_hasta,
    },
    firma: doc.firma,
  }
  return JSON.stringify(ordered, null, 2) + '\n'
}

/** licencia-<cliente en kebab-case ASCII>.cerebro-licencia, como nombre_fichero() de firmar_licencia.py. */
export function licenseFileName(cliente: string): string {
  const ascii = cliente.normalize('NFKD').replace(/[^\x00-\x7f]/g, '')
  const slug = ascii.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'cliente'
  return `licencia-${slug}${LICENSE_EXTENSION}`
}

export function formatLicenseId(year: number, sequence: number): string {
  if (sequence < 1 || sequence > 9999) throw new LicenseError(`la secuencia de ${year} esta fuera de 1-9999`)
  return `PML-LIC-${year}-${String(sequence).padStart(4, '0')}`
}

function decodeKey(base64: string, what: string): Buffer {
  const bytes = Buffer.from(base64.trim(), 'base64')
  if (bytes.length !== 32 || bytes.toString('base64') !== base64.trim()) {
    throw new LicenseError(`${what}: no son 32 bytes en base64`)
  }
  return bytes
}

/** La privada de licencias: base64 de la semilla de 32 bytes, como la escribe firmar_licencia.py --crear-clave. */
export function privateKeyFromSeed(seedBase64: string): KeyObject {
  const seed = decodeKey(seedBase64, 'la clave privada de licencias')
  return createPrivateKey({ key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]), format: 'der', type: 'pkcs8' })
}

export function publicKeyFromRaw(publicBase64: string): KeyObject {
  const raw = decodeKey(publicBase64, 'la clave publica de licencias')
  return createPublicKey({ key: Buffer.concat([SPKI_ED25519_PREFIX, raw]), format: 'der', type: 'spki' })
}

export function rawPublicKey(key: KeyObject): string {
  const der = createPublicKey(key).export({ format: 'der', type: 'spki' })
  return der.subarray(der.length - 32).toString('base64')
}

function isValidDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

/** Las comprobaciones de _validar_campos() de licencia.py. */
export function validateLicense(data: LicenseData): void {
  for (const field of ['id', 'cliente', 'nif', 'modalidad'] as const) {
    if (typeof data[field] !== 'string' || !data[field].trim()) {
      throw new LicenseError(`${field}: tiene que ser un texto no vacio`)
    }
  }
  if (!ID_RE.test(data.id)) throw new LicenseError(`id ${data.id}: no es PML-LIC-AAAA-NNNN`)
  if (!LICENSE_MODALITIES.includes(data.modalidad)) throw new LicenseError(`modalidad ${data.modalidad}: no vale`)
  if (typeof data.equipo !== 'boolean') throw new LicenseError('equipo: tiene que ser true o false')
  if (!isValidDate(data.emitida) || !isValidDate(data.soporte_hasta)) {
    throw new LicenseError('emitida y soporte_hasta: tienen que ser fechas AAAA-MM-DD')
  }
  if (data.soporte_hasta < data.emitida) throw new LicenseError('soporte_hasta es anterior a emitida')
}

/** verificar() de licencia.py: la firma primero, los campos despues. */
export function verifyLicense(text: string, publicBase64: string = LICENSES_PUBLIC_KEY): LicenseData {
  let doc: LicenseDocument
  try {
    doc = JSON.parse(text)
  } catch {
    throw new LicenseError('no es JSON')
  }
  if (!doc || typeof doc !== 'object' || Object.keys(doc).sort().join() !== 'firma,formato,licencia') {
    throw new LicenseError('se esperaba un objeto con formato, licencia y firma')
  }
  if (doc.formato !== LICENSE_FORMAT) throw new LicenseError(`formato ${doc.formato}: solo se conoce el ${LICENSE_FORMAT}`)
  const signature = Buffer.from(doc.firma, 'base64')
  if (signature.length !== 64) throw new LicenseError(`la firma tiene ${signature.length} bytes, no 64`)
  if (!verify(null, canonical(doc.licencia), publicKeyFromRaw(publicBase64), signature)) {
    throw new LicenseError('la firma no cuadra con la clave de licencias')
  }
  const fields = Object.keys(doc.licencia).sort().join()
  if (fields !== 'cliente,emitida,equipo,id,modalidad,nif,soporte_hasta') throw new LicenseError(`campos: ${fields}`)
  validateLicense(doc.licencia)
  return doc.licencia
}

/**
 * Firma una licencia y devuelve el fichero. Como emitir() de firmar_licencia.py: no firma si la
 * privada no es la de licencias.pub (no valdria en ningun cerebro) y comprueba lo firmado antes
 * de devolverlo.
 */
export function signLicense(
  data: LicenseData,
  seedBase64: string,
  expectedPublic: string = LICENSES_PUBLIC_KEY
): { text: string; fileName: string } {
  const license: LicenseData = { ...data, cliente: data.cliente.trim(), nif: data.nif.trim() }
  validateLicense(license)
  const privateKey = privateKeyFromSeed(seedBase64)
  if (rawPublicKey(privateKey) !== expectedPublic) {
    throw new LicenseError('la clave privada no es la de licencias.pub: sus licencias no valdrian en ningun cerebro')
  }
  const signature = sign(null, canonical(license), privateKey).toString('base64')
  const text = serializeLicense({ formato: LICENSE_FORMAT, licencia: license, firma: signature })
  verifyLicense(text, expectedPublic)
  return { text, fileName: licenseFileName(license.cliente) }
}

/** AAAA-MM-DD sumando meses (el dia se ajusta al ultimo del mes si no existe). */
export function addMonths(isoDate: string, months: number): string {
  const [year, month, day] = isoDate.split('-').map(Number)
  const target = new Date(Date.UTC(year, month - 1 + months, 1))
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  target.setUTCDate(Math.min(day, lastDay))
  return target.toISOString().slice(0, 10)
}
