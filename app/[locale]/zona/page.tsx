import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { CalendarClock, Clock, Download, FileText, KeyRound, LifeBuoy, Users } from 'lucide-react'
import ZoneFrame from '@/components/zone/zone-frame'
import { ButtonLink, Card, Notice, PageTitle, StatusPill } from '@/components/zone/zone-ui'
import { formatDate, formatDateTime } from '@/lib/delivery/emails'
import { hostName } from '@/lib/delivery/products'
import { generatePageMetadata } from '@/lib/metadata'
import { localePath } from '@/lib/i18n'
import { companyParam, loadZone } from '@/lib/zone-page'
import { currentLicense, monthlyState, pendingLicense, planName, sectionPath, upcomingSessions, zoneSections } from '@/lib/zone-view'

// Inicio de la zona de socio: lo de la compra de un vistazo, con lo que mas se usa a mano
// (bajar la licencia, ir a las descargas, la proxima sesion).

export const dynamic = 'force-dynamic'

type Params = Promise<{ locale: string }>

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'zone.meta' })
  return generatePageMetadata({ title: t('title'), description: t('description'), path: '/zona', locale, noindex: true })
}

export default async function ZonaPage({ params, searchParams }: { params: Params; searchParams: Promise<{ empresa?: string; mensual?: string }> }) {
  const { locale } = await params
  const { empresa, mensual } = await searchParams
  setRequestLocale(locale)
  const state = await loadZone(locale, '/zona', empresa ?? null)
  if (state.status === 'closed') return <ZoneFrame locale={locale} state={state} section="inicio" />

  const t = await getTranslations({ locale, namespace: 'zone' })
  const tOffer = await getTranslations({ locale, namespace: 'offer' })
  const loc = locale === 'en' ? 'en' : 'es'
  const { data } = state
  const now = new Date()
  const company = companyParam(data)
  const sections = zoneSections(data)
  const license = currentLicense(data.licenses)
  const pending = license ? null : pendingLicense(data)
  const monthly = monthlyState(data, now)
  const next = upcomingSessions(data, now)[0]
  const booked = data.sessions.bookings.filter((b) => b.status === 'booked').length
  const link = (section: Parameters<typeof sectionPath>[0]) => localePath(locale, sectionPath(section, company))

  return (
    <ZoneFrame locale={locale} state={state} section="inicio">
      <PageTitle title={t('home.title')} intro={data.role === 'owner' ? t('home.intro') : t('home.introMember')} />
      {mensual === 'ok' && (
        <div className="mt-6 max-w-3xl">
          <Notice role="status">{t('home.monthlyOk')}</Notice>
        </div>
      )}

      <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-5">
        <Card icon={KeyRound} title={t('home.license.title')}>
          {license ? (
            <>
              <p className="text-lg font-medium text-ink">
                {tOffer(`modalities.${license.modalidad}${license.equipo ? '-equipo' : ''}.name`)} ·{' '}
                {license.equipo ? t('license.team', { seats: data.company.seats }) : t('license.solo')}
              </p>
              <p>{license.soporteHasta > license.emitida ? t('license.supportUntil', { date: formatDate(license.soporteHasta, loc) }) : t('license.noSupport')}</p>
              <div className="flex flex-wrap gap-3 pt-2">
                <ButtonLink href={`/api/zone/licenses/${encodeURIComponent(license.id)}`} download>
                  <Download className="h-5 w-5" aria-hidden="true" />
                  {t('license.download')}
                </ButtonLink>
                <ButtonLink href={link('licencia')} variant="outline" internal>
                  {t('home.license.more')}
                </ButtonLink>
              </div>
            </>
          ) : pending ? (
            // A mano: lo que llevara la licencia que Eric aun no ha firmado, y que esta en camino.
            <>
              <p className="flex flex-wrap items-center gap-x-3 gap-y-2 text-lg font-medium text-ink">
                <span>
                  {tOffer(`modalities.${pending.modalidad}${pending.equipo ? '-equipo' : ''}.name`)} ·{' '}
                  {pending.equipo ? t('license.team', { seats: data.company.seats }) : t('license.solo')}
                </span>
                <StatusPill>
                  <Clock className="h-4 w-4" aria-hidden="true" />
                  {t('license.onTheWay')}
                </StatusPill>
              </p>
              <p>{pending.soporteHasta > pending.emitida ? t('license.supportUntil', { date: formatDate(pending.soporteHasta, loc) }) : t('license.noSupport')}</p>
              <p>{t('license.pending')}</p>
              <div className="pt-2">
                <ButtonLink href={link('licencia')} variant="outline" internal>
                  {t('home.license.more')}
                </ButtonLink>
              </div>
            </>
          ) : (
            <p>{t('license.preparing')}</p>
          )}
        </Card>

        <Card icon={Download} title={t('home.downloads.title')}>
          {data.version ? (
            <>
              <p className="text-lg font-medium text-ink">{t('downloads.version', { version: data.version.id })}</p>
              <p>{t('downloads.published', { date: formatDate(data.version.publishedAt.slice(0, 10), loc) })}</p>
              <div className="pt-2">
                <ButtonLink href={link('descargas')} internal>
                  {t('home.downloads.go')}
                </ButtonLink>
              </div>
            </>
          ) : (
            <p>{t('downloads.none')}</p>
          )}
        </Card>

        {sections.includes('sesiones') && (
          <Card icon={CalendarClock} title={t('home.sessions.title')}>
            {next ? (
              <p className="text-lg font-medium text-ink first-letter:uppercase">
                {t('home.sessions.next', { number: next.number, when: formatDateTime(next.startAt, loc), host: hostName(next.host) })}
              </p>
            ) : (
              <p>{t('home.sessions.noneUpcoming')}</p>
            )}
            {data.sessions.canBook && <p>{booked === 0 ? t('home.sessions.bookFirst') : t('home.sessions.bookSecond')}</p>}
            <div className="pt-2">
              <ButtonLink href={link('sesiones')} variant={data.sessions.canBook ? 'primary' : 'outline'} internal>
                {data.sessions.canBook ? t('home.sessions.book') : t('home.sessions.go')}
              </ButtonLink>
            </div>
          </Card>
        )}

        {sections.includes('mensual') && (
          <Card icon={LifeBuoy} title={t('home.monthly.title')}>
            <p className="text-lg font-medium text-ink">
              {monthly.kind === 'subscribed'
                ? t('home.monthly.subscribed', { plan: planName(monthly.product, tOffer) })
                : monthly.kind === 'included'
                  ? t('home.monthly.included', { date: formatDate(monthly.supportUntil, loc) })
                  : t('home.monthly.none')}
            </p>
            <p>{t('home.monthly.security')}</p>
            <div className="pt-2">
              <ButtonLink href={link('mensual')} variant="outline" internal>
                {t('home.monthly.go')}
              </ButtonLink>
            </div>
          </Card>
        )}

        {sections.includes('equipo') && (
          <Card icon={Users} title={t('home.team.title')}>
            <p className="text-lg font-medium text-ink">{t('team.count', { count: data.team.length, seats: data.company.seats })}</p>
            <p>{t('home.team.text')}</p>
            <div className="pt-2">
              <ButtonLink href={link('equipo')} variant="outline" internal>
                {t('home.team.go')}
              </ButtonLink>
            </div>
          </Card>
        )}

        {sections.includes('facturas') && (
          <Card icon={FileText} title={t('home.invoices.title')}>
            <p className="text-lg font-medium text-ink">{t('home.invoices.count', { count: data.invoices.length })}</p>
            {data.pendingInvoices > 0 && <p>{t('invoices.pending', { count: data.pendingInvoices })}</p>}
            <div className="pt-2">
              <ButtonLink href={link('facturas')} variant="outline" internal>
                {t('home.invoices.go')}
              </ButtonLink>
            </div>
          </Card>
        )}
      </div>
    </ZoneFrame>
  )
}

