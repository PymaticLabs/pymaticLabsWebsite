// Utilidades de la entrega: fechas en hora peninsular, NIF y razon social limpios, CRC32C (lo
// pide Google Cloud KMS para comprobar lo que va y viene), HTML y comparaciones de secretos.

import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto'

export const MADRID = 'Europe/Madrid'

/** AAAA-MM-DD en hora peninsular. */
export function madridDate(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: MADRID }).format(date)
}

/** Minutos que la zona va por delante de UTC en ese instante. */
function zoneOffsetMinutes(timestamp: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(timestamp))
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return Math.round((asUtc - Math.floor(timestamp / 1000) * 1000) / 60000)
}

/** El instante UTC de una hora local de Madrid (AAAA-MM-DD, horas, minutos). */
export function madridTimeToUtc(isoDate: string, hours: number, minutes = 0): Date {
  const [y, m, d] = isoDate.split('-').map(Number)
  const guess = Date.UTC(y, m - 1, d, hours, minutes)
  let utc = guess - zoneOffsetMinutes(guess, MADRID) * 60000
  const second = guess - zoneOffsetMinutes(utc, MADRID) * 60000
  if (second !== utc) utc = second
  return new Date(utc)
}

export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

/** Dia de la semana de una fecha AAAA-MM-DD: 0 domingo ... 6 sabado. */
export function weekday(isoDate: string): number {
  const [y, m, d] = isoDate.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

export function unixToIso(seconds: number): string {
  return new Date(seconds * 1000).toISOString()
}

/** NIF o NIF-IVA como lo acepta firmar_licencia.py: mayusculas, numeros y guiones. */
export function normalizeTaxId(value: string | null | undefined): string | null {
  if (!value) return null
  const clean = value.normalize('NFKC').toUpperCase().replace(/[\s.​-‏⁠﻿]/g, '')
  return /^[A-Z0-9-]{3,32}$/.test(clean) ? clean : null
}

/**
 * La razon social sin controles ni caracteres invisibles (firmar_licencia.py los rechaza: un nombre
 * copiado de un documento puede traer letras de otro alfabeto o saltos).
 */
export function cleanCompanyName(value: string | null | undefined): string | null {
  if (!value) return null
  const clean = value
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f-\u009f­​-‏‪-‮⁠-⁤﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return clean.length >= 2 && clean.length <= 200 ? clean : null
}

export function normalizeEmail(value: string | null | undefined): string | null {
  if (!value) return null
  const email = value.trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 320 ? email : null
}

export const EU_COUNTRIES = new Set([
  'AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'HU', 'IE', 'IT',
  'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK',
])

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex')
}

export function hmacHex(secret: string, data: string): string {
  return createHmac('sha256', secret).update(data).digest('hex')
}

/** Compara dos secretos sin dar pistas por el tiempo que tarda. */
export function safeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

/** El secreto de una cabecera Authorization: Bearer <secreto>. */
export function bearer(header: string | null | undefined): string | null {
  const match = /^Bearer\s+(.+)$/i.exec(header ?? '')
  return match ? match[1].trim() : null
}

export function newId(): string {
  return randomUUID()
}

export function formatMoney(cents: number, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale === 'en' ? 'en-IE' : 'es-ES', { style: 'currency', currency: currency.toUpperCase() }).format(
    cents / 100
  )
}

// CRC32C (Castagnoli), el que usa Google Cloud KMS en dataCrc32c y signatureCrc32c.
const CRC32C_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0x82f63b78 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

export function crc32c(data: Buffer): number {
  let crc = 0xffffffff
  for (const byte of data) crc = CRC32C_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
