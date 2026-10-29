// Las plazas del precio de lanzamiento y los pagos que se dejan a medias.
//
// Cada pago abierto aparta una plaza de las 10 mientras dura (unos 36 minutos) y, en el Acompanado,
// el hueco de Cal.com. Una misma conexion no aparta mas de LAUNCH_CLIENT_LIMIT a la vez (que nadie
// ocupe las 10 abriendo pagos): la IPv4, o el /56 de la IPv6 (clientIpBucket: lo que suele tener una
// casa; el /48 juntaba a clientes de un mismo operador, y con el /64 una casa se las quedaba todas).
// Pero quien vuelve atras desde Stripe y abre otro pago no pierde por eso el precio de lanzamiento
// (el diseno: solo la venta 11 paga el de lista): si no queda plaza para el nuevo y tiene otras en
// pagos a medias, se cierran en Stripe, del mas viejo al mas nuevo, y sus plazas pasan al nuevo. Solo
// los suyos: los de su conexion con su mismo NIF y su misma IP (la IPv4, o el /64: client_ref en los
// metadatos del pago). Asi nadie de la misma conexion que conozca su NIF (es publico) le cierra el
// pago, y detras de una conexion compartida (CGNAT del movil, un coworking) el pago que otra persona
// esta haciendo no se toca. Quien se queda sin plaza mientras quedan sin gastar (apartadas por pagos
// a medias de otros, o su conexion en su tope) no paga el de lista: createCheckout no abre el pago
// (launch_busy, que pruebe en media hora; los socios, 27-10-2026). Si salta varias veces en una hora,
// aviso interno (noteLaunchBusy): o hay mucha venta a la vez o alguien acapara las plazas.
//
// Lo usan lib/checkout.ts (createCheckout, en vez de repo.reserveLaunchSlot; y releaseOwnSlotHold,
// si el hueco elegido lo aparta un pago a medias suyo) y la vuelta desde Stripe (cancel_url,
// abandonCheckout por cancelCheckout en app/api/checkout/cancel). El aviso checkout.session.expired
// suelta lo mismo otra vez, sin efecto.

import { internalEmail } from './emails.ts'
import { fingerprint, ipBucket } from './limits.ts'
import { errorMessage } from './util.ts'
import type { Delivery } from './container.ts'

/** Cuantos launch_busy en una hora (en toda la web) dan el aviso interno; uno por hora como mucho. */
export const LAUNCH_BUSY_ALERT_AFTER = 3

/** Quien abre el pago: la huella de su conexion (clientIpBucket, la de launch_slots), su IP tal cual llega y su NIF. */
export interface LaunchClient {
  clientHash: string | null
  clientIp: string | null
  taxId: string | null
}

/**
 * La huella exacta del cliente en un pago con plaza (client_ref en sus metadatos): su IPv4, o su /64,
 * con la sal de la web y la plaza (launch_ref). Cada pago lleva una distinta: en Stripe no sirve para
 * juntar los pagos de una misma IP, solo para reconocer al mismo cliente cuando vuelve. null sin IP.
 */
export function clientRef(d: Delivery, clientIp: string | null | undefined, launchRef: string): string | null {
  const bucket = ipBucket(clientIp)
  return bucket ? fingerprint(d, `${bucket}|${launchRef}`) : null
}

/** Si un pago abierto con plaza es de ese cliente: su NIF y su huella exacta (client_ref) en los metadatos. */
function isOwn(d: Delivery, metadata: Record<string, string | undefined>, client: LaunchClient, launchRef: string): boolean {
  const ref = clientRef(d, client.clientIp, launchRef)
  return Boolean(client.taxId && ref && metadata.tax_id === client.taxId && metadata.client_ref === ref)
}

/**
 * Cuenta un launch_busy (en toda la web, en ventanas de una hora) y, al llegar a
 * LAUNCH_BUSY_ALERT_AFTER, avisa a PymaticLabs una sola vez en esa hora. Gente sin poder comprar
 * mientras quedan plazas es mucha venta a la vez o alguien que las acapara con pagos que no termina.
 * El aviso dice las plazas que quedan, por que salto el ultimo (su conexion en su tope, con sus pagos
 * abiertos, o las que quedan apartadas por otros) y que hacer. Nunca hace fallar el pago: sin base o
 * sin correo, solo el registro. true si avisa.
 */
export async function noteLaunchBusy(
  d: Delivery,
  input: { clientHash: string | null; product: string; placesLeft: number; clientLimit: number },
  now: Date
): Promise<boolean> {
  try {
    const hit = await d.repo.hitRateLimit('launch-busy:todos', 3600, LAUNCH_BUSY_ALERT_AFTER, now)
    if (hit.count !== LAUNCH_BUSY_ALERT_AFTER) return false
    const held = input.clientHash ? (await d.repo.listOpenLaunchSlots(input.clientHash, now)).map((s) => s.sessionId ?? `plaza ${s.ref} sin pago`) : []
    const atCap = held.length >= input.clientLimit
    const mail = internalEmail(
      `Plazas de lanzamiento: ${hit.count} compras sin plaza en una hora`,
      {
        'Qué hacer':
          "Ver qué pagos apartan las plazas, en SQL (Stripe no busca las sesiones de Checkout por sus metadatos): select checkout_session_id, client_hash, expires_at from launch_slots where status = 'reserved' and expires_at > now() order by client_hash; client_hash es la conexión. Si alguien las acapara (muchos a medias desde las mismas conexiones, o con identificaciones que no cuadran), cerrar esos pagos en Stripe (Expire session): sus plazas quedan libres al momento. Si es mucha venta a la vez, nada",
        'Plazas sin gastar': `${input.placesLeft} de ${d.config.launchLimit}`,
        'La última': `${input.product}: ${atCap ? `su conexión ya tenía ${held.length} pagos abiertos con plaza (el tope es ${input.clientLimit})` : 'las que quedan, apartadas por pagos a medias de otros'}`,
        'Pagos de esa conexión': held.length ? held.join(', ') : null,
      },
      'Hay quien se queda sin el precio de lanzamiento quedando plazas: se le pide que pruebe en media hora (launch_busy). Este aviso sale una vez por hora como mucho.'
    )
    await d.mailer.send({ to: d.config.alertEmail, ...mail, idempotencyKey: `launch-busy:${hit.resetAt}`, tags: ['alerta'] })
    return true
  } catch (error) {
    console.error(`[lanzamiento] aviso de launch_busy sin enviar: ${errorMessage(error)}`)
    return false
  }
}

/** Suelta lo que apartaba un pago que ya no se va a cobrar: su plaza de lanzamiento y su hueco. */
export async function releaseCheckoutHolds(d: Delivery, metadata: Record<string, string | undefined>): Promise<void> {
  if (metadata.launch_ref) await d.repo.markLaunchSlot(metadata.launch_ref, 'released')
  if (metadata.calendar_reservation) {
    try {
      await d.calendar.release(metadata.calendar_reservation)
    } catch {
      // caduca sola
    }
  }
}

/**
 * Aparta una plaza para un pago nuevo (como repo.reserveLaunchSlot). Si no hay y ese cliente tiene
 * plazas en pagos abiertos (su tope, o las 10 apartadas), cierra en Stripe los suyos que hagan falta,
 * el mas viejo primero, y vuelve a probar. Suyos: de su conexion, con su NIF (taxId, ya comprobado)
 * y su huella exacta (client_ref), que se leen en Stripe antes de cerrar nada. Uno que ya se pago no
 * se toca. false: no queda plaza para el (las 10 gastadas o apartadas por otros).
 */
export async function reserveLaunchPlace(
  d: Delivery,
  input: LaunchClient & { ref: string; product: string; expiresAt: string; limit: number; clientLimit: number },
  now: Date
): Promise<boolean> {
  const { taxId, clientIp, ...slot } = input
  if (await d.repo.reserveLaunchSlot(slot, now)) return true
  if (!input.clientHash || !taxId || !clientIp) return false
  const open = (await d.repo.listOpenLaunchSlots(input.clientHash, now)).filter((s) => s.sessionId)
  if (!open.length) return false
  // Las que le sobran para quedar por debajo de su tope; si el tope no era el problema (las 10 estan
  // apartadas), la mas vieja suya: la plaza pasa del pago a medias al nuevo.
  let toFree = Math.max(1, open.length - input.clientLimit + 1)
  for (const held of open) {
    if (toFree <= 0) break
    try {
      const current = await d.payments.getCheckoutSession(held.sessionId!)
      // Pagado y con el aviso aun en camino: esa plaza ya es suya (la gasta el aviso).
      if (current.status === 'complete') continue
      // El pago de otra persona de la misma conexion (otro NIF, u otra IP con el mismo): se deja como esta.
      if (current.status === 'open' && !isOwn(d, current.metadata, input, held.ref)) continue
      const closed = current.status === 'open' ? await d.payments.expireCheckoutSession(held.sessionId!) : current
      if (closed.status === 'complete') continue
      await releaseCheckoutHolds(d, { ...closed.metadata, launch_ref: held.ref })
      toFree -= 1
    } catch (error) {
      // Stripe sin contestar: sin plaza para el pago nuevo (createCheckout contesta launch_busy).
      console.warn(`[lanzamiento] no se pudo cerrar el pago a medias ${held.sessionId}:`, error instanceof Error ? error.message : error)
      break
    }
  }
  return d.repo.reserveLaunchSlot(slot, now)
}

/**
 * El Acompanado con un hueco que aparta un pago a medias del mismo cliente (de su conexion, con su
 * NIF y su huella exacta): vuelve atras con el navegador, sin pasar por /api/checkout/cancel, y elige
 * el mismo. Se cierran en Stripe sus pagos abiertos con ese hueco (misma persona e inicio en los
 * metadatos), que sueltan su plaza y su hueco. Uno pagado, cerrado, de otro NIF o de otra IP no se
 * toca. true si se cerro alguno.
 *
 * Limite: solo se encuentran los pagos con plaza de lanzamiento (launch_slots guarda la huella de la
 * conexion y el id del pago). Uno sin plaza (pasadas las 10 ventas, o con su tope de plazas por
 * conexion) no se ve, y su hueco sigue apartado hasta que caduca (unos 35 minutos): para cubrirlo
 * haria falta guardar la huella del cliente con el hueco apartado.
 */
export async function releaseOwnSlotHold(d: Delivery, client: LaunchClient, slot: { host: string; start: string }, now: Date): Promise<boolean> {
  if (!client.clientHash) return false
  let released = false
  for (const held of await d.repo.listOpenLaunchSlots(client.clientHash, now)) {
    if (!held.sessionId) continue
    try {
      const current = await d.payments.getCheckoutSession(held.sessionId)
      const m = current.metadata
      if (current.status !== 'open' || !isOwn(d, m, client, held.ref) || m.session_host !== slot.host || m.session_start !== slot.start) continue
      if (await abandonCheckout(d, held.sessionId)) released = true
    } catch (error) {
      // Stripe sin contestar: el hueco sigue apartado (slot_taken, como antes).
      console.warn(`[lanzamiento] no se pudo cerrar el pago a medias ${held.sessionId}:`, error instanceof Error ? error.message : error)
      break
    }
  }
  return released
}

/**
 * La vuelta desde Stripe sin pagar (cancel_url con {CHECKOUT_SESSION_ID}): se cierra ese pago y se
 * sueltan su plaza y su hueco al momento, sin esperar a que caduque. El id de la sesion solo lo
 * tiene quien abrio el pago (va en su URL). true si se cerro.
 */
export async function abandonCheckout(d: Delivery, sessionId: string): Promise<boolean> {
  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) return false
  const closed = await d.payments.expireCheckoutSession(sessionId)
  if (closed.status !== 'expired') return false
  await releaseCheckoutHolds(d, closed.metadata)
  return true
}
