import { unstable_cache } from 'next/cache'
import { launchPlacesLeft } from '@/lib/checkout'
import { zoneAvailable } from '@/lib/delivery/config'
import { getDelivery } from '@/lib/delivery/container'
import { withTimeout } from '@/lib/delivery/util'
import { currentSecuritySupport } from '@/lib/delivery/versions'

// Lo que /precios y /comprar leen de la entrega, guardado 5 minutos para que sigan siendo rapidas:
// - si quedan plazas de lanzamiento (las gastadas, como las cuenta el pago): sin ninguna, solo el
//   precio de lista (la venta 11 ya lo paga sola). /comprar las lee sin la cache (fresh): justo
//   despues de la venta 10 no puede seguir anunciando el de lanzamiento (oferta v1.9);
// - hasta cuando tiene correcciones de seguridad la version que se vende (politica de
//   vulnerabilidades v1.7: la fecha de fin, con mes y ano, en la pagina de compra).
// Sin la base de datos (o si no contesta en 3 s), lo de siempre: el precio de lanzamiento, sin
// cuantas plazas quedan y sin fecha. Un fallo no se guarda: se vuelve a preguntar en la visita
// siguiente.

export interface OfferStatus {
  launchOpen: boolean
  /** Las plazas de lanzamiento que quedan («Quedan 7 de 10»); null sin la base o si no contesta. */
  launchLeft: number | null
  security: { version: string; until: string } | null
}

export const DEFAULT_OFFER_STATUS: OfferStatus = { launchOpen: true, launchLeft: null, security: null }

const TIMEOUT_MS = 3000

const cachedStatus = unstable_cache(
  async (): Promise<OfferStatus> => {
    const d = getDelivery()
    const [left, security] = await withTimeout(Promise.all([launchPlacesLeft(d), currentSecuritySupport(d)]), TIMEOUT_MS, 'la base de datos no contesta')
    return { launchOpen: left > 0, launchLeft: Math.max(0, left), security }
  },
  // Otra clave si cambia lo que se guarda: lo guardado con la forma de antes no lleva launchLeft.
  ['oferta-plazas-y-seguridad-2'],
  { revalidate: 300 }
)

/** fresh: las plazas de lanzamiento preguntadas ahora, sin la cache (la fecha de seguridad, de la cache). */
export async function offerStatus(options: { fresh?: boolean } = {}): Promise<OfferStatus> {
  if (!zoneAvailable()) return DEFAULT_OFFER_STATUS
  const [cached, fresh] = await Promise.allSettled([
    (async () => cachedStatus())(),
    (async () => (options.fresh ? withTimeout(launchPlacesLeft(getDelivery()), TIMEOUT_MS, 'la base de datos no contesta') : null))(),
  ])
  if (cached.status === 'rejected') console.error('[precios] plazas y fecha de seguridad:', cached.reason)
  if (fresh.status === 'rejected') console.error('[comprar] plazas de lanzamiento:', fresh.reason)
  const status = cached.status === 'fulfilled' ? cached.value : DEFAULT_OFFER_STATUS
  return fresh.status === 'fulfilled' && fresh.value !== null
    ? { ...status, launchOpen: fresh.value > 0, launchLeft: Math.max(0, fresh.value) }
    : status
}

/** «octubre de 2031» / «October 2031»: la fecha de fin de la seguridad, con mes y ano. */
export function formatMonthYear(isoDate: string, locale: string): string {
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'es-ES', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${isoDate}T12:00:00Z`))
}
