// Limites contra el abuso: cuantos codigos se piden y se prueban, cuantos pagos se abren y cuantos
// huecos de Cal.com se apartan, por IP y por correo, en ventanas fijas (tabla rate_limits).
//
// La IP cuenta por bloque: una IPv4 entera, o su /64 en IPv6 (una sola maquina tiene millones de
// direcciones en su /64); las plazas de lanzamiento, por el /56 (clientIpBucket), y VIES y los huecos
// de Cal.com, por el /48 (wideIpBucket). Ni la IP ni el correo se guardan: la clave lleva su huella
// con la sal de la web (DELIVERY_IP_SALT).

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

/**
 * El bloque ancho de una IP: para lo que cuesta llamadas a otros (VIES) y los huecos de Cal.com
 * apartados (que no se gaste el tope de todos). La IPv4 tal cual, o el /48 de una IPv6 (con bloques
 * /64, una sola casa tiene cientos y multiplicaba el limite).
 */
export function wideIpBucket(ip: string | null | undefined): string | null {
  const bucket = ipBucket(ip)
  return bucket?.endsWith('::/64') ? `${bucket.split(':').slice(0, 3).join(':')}::/48` : bucket
}

/**
 * La conexion de un cliente, para el tope de plazas de lanzamiento por cliente (lib/delivery/launch.ts):
 * la IPv4 tal cual, o el /56 de una IPv6, lo que un operador suele dar a una casa. El /48 juntaba a
 * clientes de un mismo operador que no se conocen; con el /64, una casa con un /56 (256 bloques) se
 * quedaba todas las plazas.
 */
export function clientIpBucket(ip: string | null | undefined): string | null {
  const bucket = ipBucket(ip)
  if (!bucket?.endsWith('::/64')) return bucket
  const groups = bucket.split(':')
  return `${groups.slice(0, 3).join(':')}:${groups[3].slice(0, 2)}00::/56`
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
