import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { CalendarClock, Video } from 'lucide-react'
import ZoneFrame, { ZoneClientMessages } from '@/components/zone/zone-frame'
import SessionPicker, { type SlotDay } from '@/components/zone/session-picker'
import { ButtonLink, Card, Notice, PageTitle } from '@/components/zone/zone-ui'
import { getDelivery } from '@/lib/delivery/container'
import { formatDateTime } from '@/lib/delivery/emails'
import { SESSION_HOSTS, hostName } from '@/lib/delivery/products'
import { sessionSlots } from '@/lib/delivery/zone'
import type { Slot } from '@/lib/delivery/types'
import { generatePageMetadata } from '@/lib/metadata'
import { loadZone } from '@/lib/zone-page'

// Las sesiones de montaje del Acompanado: las reservadas (la primera se elige al comprar) y, si
// falta alguna, los huecos libres de Eric y de Sergio para reservarla (Cal.com). Solo reserva quien
// compro; el equipo las ve.

export const dynamic = 'force-dynamic'

type Params = Promise<{ locale: string }>

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'zone' })
  return generatePageMetadata({ title: t('sessions.title'), description: t('meta.description'), path: '/zona/sesiones', locale, noindex: true })
}

export default async function SesionesPage({ params, searchParams }: { params: Params; searchParams: Promise<{ empresa?: string; reservada?: string }> }) {
  const { locale } = await params
  const { empresa, reservada } = await searchParams
  setRequestLocale(locale)
  const state = await loadZone(locale, '/zona/sesiones', empresa ?? null)
  if (state.status === 'closed') return <ZoneFrame locale={locale} state={state} section="sesiones" />

  const t = await getTranslations({ locale, namespace: 'zone.sessions' })
  const loc = locale === 'en' ? 'en' : 'es'
  const { data, user } = state
  const now = Date.now()
  const bookings = [...data.sessions.bookings].sort((a, b) => a.number - b.number)
  const booked = bookings.filter((b) => b.status === 'booked')
  const firstFailed = bookings.some((b) => b.number === 1 && b.status === 'failed')
  const first = booked.find((b) => b.number === 1) ?? null

  // Los huecos, solo si falta alguna sesion por reservar (y se piden en el servidor, con su sesion).
  let days: SlotDay[] = []
  let thirdWeek = false
  let slotsFailed = false
  if (data.sessions.canBook) {
    try {
      const found = await sessionSlots(getDelivery(), user, data.company.id)
      thirdWeek = found.thirdWeek
      // La segunda, despues de la primera (que dura una hora).
      const after = first ? new Date(first.startAt).getTime() + 3600_000 : 0
      days = groupByDay(
        found.slots.filter((slot) => new Date(slot.start).getTime() >= after),
        loc,
        (host) => t('with', { host })
      )
    } catch (error) {
      console.error('[zona] huecos:', error)
      slotsFailed = true
    }
  }

  return (
    <ZoneFrame locale={locale} state={state} section="sesiones">
      <PageTitle title={t('title')} intro={t('intro')} />

      <div className="mt-8 max-w-3xl space-y-6">
        {reservada === '1' && <Notice role="status">{t('bookedNotice')}</Notice>}
        {!data.sessions.guided && data.role === 'owner' ? (
          <Notice>{t('notGuided')}</Notice>
        ) : (
          <Card icon={CalendarClock} title={t('bookedTitle')}>
            {booked.length === 0 && !firstFailed && <p>{t('noneBooked')}</p>}
            <ul className="space-y-4">
              {bookings.map((b) => {
                const past = new Date(b.startAt).getTime() < now
                return (
                  <li key={b.number} className="rounded-xl border border-line p-4">
                    <p className="text-sm font-semibold uppercase tracking-wider text-brand">{t('number', { number: b.number })}</p>
                    {b.status === 'booked' ? (
                      <>
                        <p className="mt-1 text-lg font-medium text-ink first-letter:uppercase">{formatDateTime(b.startAt, loc)}</p>
                        <p className="text-body">
                          {t('withHost', { host: hostName(b.host) })} · {past ? t('past') : t('upcoming')}
                        </p>
                        {b.meetingUrl && !past && (
                          <div className="mt-3">
                            <ButtonLink href={b.meetingUrl} variant="outline">
                              <Video className="h-5 w-5" aria-hidden="true" />
                              {t('join')}
                            </ButtonLink>
                          </div>
                        )}
                      </>
                    ) : (
                      <p className="mt-1 text-body">{b.status === 'failed' ? t('failed') : t('cancelled')}</p>
                    )}
                  </li>
                )
              })}
            </ul>
            <p>{t('change')}</p>
          </Card>
        )}

        {data.sessions.canBook && (
          <div className="rounded-2xl border border-line bg-surface p-5 sm:p-7">
            {thirdWeek && <p className="mb-4 text-base font-medium text-ink">{t('thirdWeek')}</p>}
            {slotsFailed ? (
              <Notice tone="warning" role="alert">
                {t('slotsError')}
              </Notice>
            ) : days.length === 0 ? (
              <Notice>{t('noSlots')}</Notice>
            ) : (
              <ZoneClientMessages>
                <SessionPicker
                  companyId={data.company.id}
                  days={days}
                  number={booked.length ? 2 : 1}
                  hosts={SESSION_HOSTS.map((h) => ({ id: h.id, name: h.name }))}
                  defaultHost={first?.host ?? null}
                />
              </ZoneClientMessages>
            )}
          </div>
        )}

        {data.role !== 'owner' && <Notice>{t('memberNote')}</Notice>}
      </div>
    </ZoneFrame>
  )
}

/** Los huecos por dia (hora peninsular), como en la pagina de compra. */
function groupByDay(slots: Slot[], locale: 'es' | 'en', withHost: (host: string) => string): SlotDay[] {
  const intl = locale === 'en' ? 'en-GB' : 'es-ES'
  const dayFormat = new Intl.DateTimeFormat(intl, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Madrid' })
  const timeFormat = new Intl.DateTimeFormat(intl, { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' })
  const days = new Map<string, SlotDay>()
  for (const slot of slots.slice(0, 120)) {
    const date = new Date(slot.start)
    const day = dayFormat.format(date)
    const entry = days.get(day) ?? { day, slots: [] }
    const host = hostName(slot.host)
    entry.slots.push({ value: `${slot.host}|${slot.start}`, time: timeFormat.format(date), hostId: slot.host, host, label: `${day}, ${timeFormat.format(date)} (${withHost(host)})` })
    days.set(day, entry)
  }
  return [...days.values()]
}
