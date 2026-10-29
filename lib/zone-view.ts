// Lo que ensena la zona de socio (app/[locale]/zona) a partir de zoneOverview, sin React: que
// secciones ve cada persona, la licencia que vale ahora, en que punto esta su mantenimiento y
// soporte, las descargas por sistema y a donde se vuelve tras entrar. Lo prueba lib/zone.test.mts.
//
// Sin imports con alias (@/...): las pruebas corren con `node --test`, sin compilar.

import { madridDate } from './delivery/util.ts'
import type { zoneOverview } from './delivery/zone.ts'
import type { Locale } from './delivery/types.ts'

export type ZoneOverview = Awaited<ReturnType<typeof zoneOverview>>
export type ZoneLicense = ZoneOverview['licenses'][number]
export type ZoneBooking = ZoneOverview['sessions']['bookings'][number]
export type ZoneFile = NonNullable<ZoneOverview['version']>['files'][number]

export const ZONE_SECTIONS = ['inicio', 'licencia', 'descargas', 'sesiones', 'equipo', 'mensual', 'facturas'] as const
export type ZoneSection = (typeof ZONE_SECTIONS)[number]

/**
 * Las secciones de cada persona: quien compro ve todo lo suyo; una persona del equipo, la licencia,
 * las descargas y las sesiones ya reservadas. El equipo, solo con equipo; las sesiones, solo en el
 * Acompanado. El servidor lo vuelve a comprobar en cada accion: esto solo ordena lo que se ensena.
 */
export function zoneSections(o: ZoneOverview): ZoneSection[] {
  const owner = o.role === 'owner'
  return ZONE_SECTIONS.filter((section) => {
    if (section === 'sesiones') return o.sessions.guided || o.sessions.bookings.length > 0
    if (section === 'equipo') return owner && o.company.seats > 1
    if (section === 'mensual' || section === 'facturas') return owner
    return true
  })
}

/** La ruta de una seccion (sin el prefijo del idioma) y, si la persona esta en varias empresas, cual. */
export function sectionPath(section: ZoneSection, companyId: string | null = null): string {
  const path = section === 'inicio' ? '/zona' : `/zona/${section}`
  return companyId ? `${path}?empresa=${encodeURIComponent(companyId)}` : path
}

/** La licencia que vale ahora: la no anulada que llega mas lejos (la del ultimo cobro del mensual). */
export function currentLicense(licenses: ZoneLicense[]): ZoneLicense | null {
  return (
    licenses
      .filter((l) => !l.revoked)
      .sort((a, b) => b.soporteHasta.localeCompare(a.soporteHasta) || b.emitida.localeCompare(a.emitida) || b.id.localeCompare(a.id))[0] ?? null
  )
}

/**
 * La que Eric aun tiene que firmar (LICENSE_MODE=manual) y se ensena en su lugar mientras no hay
 * ninguna: la del pago unico antes que la de un cobro del mensual.
 */
export function pendingLicense(o: ZoneOverview): ZoneOverview['pendingLicenses'][number] | null {
  return o.pendingLicenses.find((p) => p.kind === 'one_time') ?? o.pendingLicenses[0] ?? null
}

/** Las demas, de la mas nueva a la mas antigua, anuladas incluidas. */
export function otherLicenses(licenses: ZoneLicense[], current: ZoneLicense | null): ZoneLicense[] {
  return licenses.filter((l) => l.id !== current?.id).sort((a, b) => b.emitida.localeCompare(a.emitida) || b.id.localeCompare(a.id))
}

/** Estados de Stripe en los que la suscripcion sigue viva (cobrando, en prueba o con un cobro pendiente). */
const SUBSCRIBED = ['active', 'trialing', 'past_due', 'unpaid', 'paused']

export type MonthlyState =
  | { kind: 'subscribed'; product: string | null; status: string; supportUntil: string | null }
  | { kind: 'included'; supportUntil: string }
  | { kind: 'none'; supportUntil: string | null }

/**
 * El mantenimiento y soporte: con el mensual contratado; con meses incluidos en la compra que aun
 * no han acabado; o sin el (la licencia sigue valiendo y las correcciones de seguridad llegan igual).
 * Una licencia sin meses (Hazlo tu sin equipo: soporte_hasta es el dia de la compra) no incluye nada,
 * tampoco ese dia: como en la pagina de la licencia (clausula 3). supportUntil es lo pagado o
 * incluido (paidUntil): la licencia cubre 15 dias mas, el margen de un cobro fallido, y el mensual
 * contratado se cobra desde el dia siguiente a lo incluido.
 */
export function monthlyState(o: ZoneOverview, now: Date): MonthlyState {
  const current = currentLicense(o.licenses)
  const supportUntil = current?.paidUntil ?? null
  const status = o.company.subscription.status
  if (status && SUBSCRIBED.includes(status)) return { kind: 'subscribed', product: o.company.subscription.plan, status, supportUntil }
  if (current && current.paidUntil > current.emitida && current.paidUntil >= madridDate(now)) return { kind: 'included', supportUntil: current.paidUntil }
  return { kind: 'none', supportUntil }
}

/** El nombre del plan del mensual ("Pro" de "plan-pro"), con los textos de la oferta. */
export function planName(product: string | null, tOffer: (key: string) => string): string {
  const plan = product?.replace(/^plan-/, '')
  return plan === 'esencial' || plan === 'pro' || plan === 'premium' ? tOffer(`plans.${plan}`) : (product ?? '')
}

/** Las sesiones reservadas que aun no han pasado, la mas cercana primero. */
export function upcomingSessions(o: ZoneOverview, now: Date): ZoneBooking[] {
  return o.sessions.bookings
    .filter((b) => b.status === 'booked' && new Date(b.startAt).getTime() > now.getTime())
    .sort((a, b) => a.startAt.localeCompare(b.startAt))
}

export type DownloadGroupKind = 'mac' | 'windows' | 'registry' | 'extra'

export interface DownloadGroup {
  kind: DownloadGroupKind
  files: ZoneFile[]
}

const GROUPS: [DownloadGroupKind, string[]][] = [
  ['mac', ['mac']],
  ['windows', ['windows']],
  ['registry', ['registry']],
  ['extra', ['sbom', 'checksum', 'other']],
]

/** Las descargas por sistema: primero el idioma de la pagina, luego el otro, luego las sin idioma. */
export function downloadGroups(files: ZoneFile[], locale: Locale): DownloadGroup[] {
  const rank = (lang: string | null) => (lang === locale ? 0 : lang ? 1 : 2)
  return GROUPS.map(([kind, kinds]) => ({
    kind,
    files: files.filter((f) => kinds.includes(f.kind)).sort((a, b) => rank(a.lang) - rank(b.lang) || a.fileName.localeCompare(b.fileName)),
  })).filter((group) => group.files.length > 0)
}

/** El tamano de un fichero para leerlo de un vistazo: 18,4 MB. */
export function formatBytes(size: number | null, locale: Locale): string | null {
  if (size === null || !Number.isFinite(size) || size < 0) return null
  const units = ['B', 'KB', 'MB', 'GB']
  let value = size
  let unit = 0
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000
    unit += 1
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1
  return `${new Intl.NumberFormat(locale === 'en' ? 'en-GB' : 'es-ES', { maximumFractionDigits: digits }).format(value)} ${units[unit]}`
}

/**
 * A donde se vuelve tras entrar: solo a una pagina de la zona de esta web (nunca a otra web ni a la
 * propia pagina de entrar). Lo demas, al inicio de la zona.
 */
export function safeZoneReturn(value: unknown, locale: Locale): string {
  const home = locale === 'en' ? '/en/zona' : '/zona'
  if (typeof value !== 'string') return home
  const match = /^\/(?:en\/)?zona(?:\/([a-z]+))?(?:\?empresa=[\w-]+)?$/.exec(value)
  if (!match || match[1] === 'entrar') return home
  if (match[1] && !(ZONE_SECTIONS as readonly string[]).includes(match[1])) return home
  return value
}
