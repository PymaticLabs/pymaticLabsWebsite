// Limites contra el abuso: cuantos codigos se piden y se prueban, cuantos pagos se abren y cuantos
// huecos de Cal.com se apartan, por IP y por correo, en ventanas fijas (tabla rate_limits).
//
// La IP cuenta por bloque: una IPv4 entera, o su /64 en IPv6 (una sola maquina tiene millones de
// direcciones en su /64). Ni la IP ni el correo se guardan: la clave lleva su huella con la sal de
// la web (DELIVERY_IP_SALT).

import { isIP } from 'node:net'
import { hmacHex } from './util.ts'
import type { Delivery } from './container.ts'

/** El bloque que cuenta de una IP: la IPv4 tal cual (tambien la que viene como ::ffff:a.b.c.d) o el /64 de una IPv6. */
export function ipBucket(ip: string | null | undefined): string | null {
  const value = ip?.trim().replace(/^\[|\]$/g, '').split('%')[0] ?? ''
  if (!value) return null
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(value)
  if (mapped) return mapped[1]
  const kind = isIP(value)
  if (kind === 4) return value
  if (kind !== 6) return null
  const [head, tail = ''] = value.toLowerCase().split('::')
  const left = head ? head.split(':') : []
  const right = tail ? tail.split(':') : []
  // Una IPv4 al final (2001:db8::1.2.3.4) ocupa dos grupos.
  const size = (parts: string[]) => parts.reduce((n, part) => n + (part.includes('.') ? 2 : 1), 0)
  const groups = value.includes('::') ? [...left, ...Array(Math.max(0, 8 - size(left) - size(right))).fill('0'), ...right] : left
  return `${groups
    .slice(0, 4)
    .map((g) => g.padStart(4, '0'))
    .join(':')}::/64`
}

/** La huella de una IP o de un correo: lo que se guarda en vez del dato. */
export function fingerprint(d: Delivery, value: string): string {
  return hmacHex(d.config.ipSalt, value).slice(0, 32)
}

/**
 * Un intento mas de `name` para `value` (una IP ya en bloque, un correo, una empresa): true si aun
 * entra en el limite. Sin valor (no se sabe la IP), no cuenta.
 */
export async function withinLimit(d: Delivery, name: string, value: string | null, limit: number, windowSeconds: number): Promise<boolean> {
  if (!value) return true
  const { allowed } = await d.repo.hitRateLimit(`${name}:${fingerprint(d, value)}`, windowSeconds, limit, d.clock())
  return allowed
}

export async function clearLimit(d: Delivery, name: string, value: string): Promise<void> {
  await d.repo.clearRateLimit(`${name}:${fingerprint(d, value)}`)
}
