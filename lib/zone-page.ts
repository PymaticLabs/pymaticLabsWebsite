import { cache } from 'react'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { zoneAvailable } from '@/lib/delivery/config'
import { getDelivery } from '@/lib/delivery/container'
import { ZoneError, zoneOverview } from '@/lib/delivery/zone'
import type { CookieJar, ZoneUser } from '@/lib/delivery/types'
import { localePath } from '@/lib/i18n'
import type { ZoneOverview } from '@/lib/zone-view'

// Las paginas de la zona de socio leen la sesion y los datos en el servidor, con las mismas
// funciones que /api/zone/* (lib/delivery/zone.ts): cada una comprueba que la persona tiene acceso
// a esa empresa. Las acciones (bajar, dar de alta, reservar, el portal) van a /api/zone/*, que lo
// vuelve a comprobar. Nada de lo que diga el navegador abre nada.

/** Las cookies de la peticion, solo para leer: una pagina no puede ponerlas (la sesion la renueva proxy.ts). */
async function readOnlyJar(): Promise<CookieJar> {
  const store = await cookies()
  return {
    getAll: () => store.getAll().map((c) => ({ name: c.name, value: c.value })),
    setAll: () => {},
  }
}

/** Quien mira, si tiene sesion (una vez por peticion). Sin la zona montada, nadie: todo lleva a entrar, que lo explica. */
export const zoneUser = cache(async (): Promise<ZoneUser | null> =>
  zoneAvailable() ? getDelivery().auth.currentUser(await readOnlyJar()) : null
)

export type ZoneState = { status: 'open'; user: ZoneUser; data: ZoneOverview } | { status: 'closed'; user: ZoneUser }

/**
 * La zona de quien mira. Sin sesion, a la pagina de entrar (y de vuelta aqui despues). Con sesion
 * pero sin acceso (devolucion o contracargo, o dado de baja del equipo), la zona cerrada.
 */
export const loadZone = cache(async (locale: string, returnTo: string, companyId: string | null): Promise<ZoneState> => {
  const user = await zoneUser()
  if (!user) redirect(`${localePath(locale, '/zona/entrar')}?volver=${encodeURIComponent(localePath(locale, returnTo))}`)
  let data: ZoneOverview
  try {
    data = await zoneOverview(getDelivery(), user, companyId)
  } catch (error) {
    if (error instanceof ZoneError && error.status === 403) return { status: 'closed', user }
    // Una empresa que no es suya (o que ya no existe): a la suya.
    if (error instanceof ZoneError && error.status === 404) redirect(localePath(locale, '/zona'))
    throw error
  }
  return { status: 'open', user, data }
})

/** ?empresa= solo cuando la persona esta en mas de una empresa (para no ensuciar los enlaces). */
export function companyParam(data: ZoneOverview): string | null {
  return data.companies.length > 1 ? data.company.id : null
}
