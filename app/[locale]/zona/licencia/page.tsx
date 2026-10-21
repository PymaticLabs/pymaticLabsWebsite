import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Clock, Download, KeyRound } from 'lucide-react'
import ZoneFrame from '@/components/zone/zone-frame'
import { ButtonLink, Card, Facts, Notice, PageTitle, StatusPill } from '@/components/zone/zone-ui'
import { formatDate } from '@/lib/delivery/emails'
import { generatePageMetadata } from '@/lib/metadata'
import { loadZone } from '@/lib/zone-page'
import { currentLicense, otherLicenses, pendingLicense } from '@/lib/zone-view'

// La licencia: el fichero firmado que pide el montaje, para volver a bajarlo cuando haga falta. La
// vigente arriba; debajo, las anteriores (cada cobro del mensual da una nueva) y las anuladas. Con
// las licencias a mano, la que Eric aun no ha firmado sale como en camino.

export const dynamic = 'force-dynamic'

type Params = Promise<{ locale: string }>

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'zone' })
  return generatePageMetadata({ title: t('license.title'), description: t('meta.description'), path: '/zona/licencia', locale, noindex: true })
}

export default async function LicenciaPage({ params, searchParams }: { params: Params; searchParams: Promise<{ empresa?: string }> }) {
  const { locale } = await params
  const { empresa } = await searchParams
  setRequestLocale(locale)
  const state = await loadZone(locale, '/zona/licencia', empresa ?? null)
  if (state.status === 'closed') return <ZoneFrame locale={locale} state={state} section="licencia" />

  const t = await getTranslations({ locale, namespace: 'zone' })
  const tOffer = await getTranslations({ locale, namespace: 'offer' })
  const loc = locale === 'en' ? 'en' : 'es'
  const { data } = state
  const current = currentLicense(data.licenses)
  const others = otherLicenses(data.licenses, current)
  const pending = current ? null : pendingLicense(data)
  const kind = (l: { modalidad: string; equipo: boolean }) => tOffer(`modalities.${l.modalidad}${l.equipo ? '-equipo' : ''}.name`)
  const href = (id: string) => `/api/zone/licenses/${encodeURIComponent(id)}`

  return (
    <ZoneFrame locale={locale} state={state} section="licencia">
      {/* Sin ninguna aun (a mano, sin firmar), no se dice que se baja aqui otra vez. */}
      <PageTitle title={t('license.title')} intro={pending ? t('license.introPending') : t('license.intro')} />

      <div className="mt-8 max-w-3xl space-y-6">
        {current && data.pendingLicenses.length > 0 && <Notice role="status">{t('license.pendingRenewal')}</Notice>}
        {current ? (
          <Card icon={KeyRound} title={t('license.current')}>
            <Facts
              items={[
                { label: t('license.fields.id'), value: <span className="font-mono">{current.id}</span> },
                { label: t('license.fields.holder'), value: `${data.company.name} · ${data.company.taxId}` },
                { label: t('license.fields.kind'), value: kind(current) },
                { label: t('license.fields.people'), value: current.equipo ? t('license.team', { seats: data.company.seats }) : t('license.solo') },
                { label: t('license.fields.issued'), value: formatDate(current.emitida, loc) },
                {
                  label: t('license.fields.support'),
                  value: current.soporteHasta > current.emitida ? formatDate(current.soporteHasta, loc) : t('license.noSupportShort'),
                },
              ]}
            />
            <div className="flex flex-wrap items-center gap-3 pt-3">
              <ButtonLink href={href(current.id)} download>
                <Download className="h-5 w-5" aria-hidden="true" />
                {t('license.download')}
              </ButtonLink>
              <span className="text-sm text-muted break-all">{current.fileName}</span>
            </div>
          </Card>
        ) : pending ? (
          // A mano: lo que llevara la que Eric aun no ha firmado; en cuanto la sube, sale arriba para bajarla.
          <Card icon={KeyRound} title={t('license.pendingTitle')}>
            <div role="status" className="flex flex-wrap items-center gap-3">
              <StatusPill>
                <Clock className="h-4 w-4" aria-hidden="true" />
                {t('license.onTheWay')}
              </StatusPill>
              <span>{t('license.pending')}</span>
            </div>
            <Facts
              items={[
                { label: t('license.fields.holder'), value: `${data.company.name} · ${data.company.taxId}` },
                { label: t('license.fields.kind'), value: kind(pending) },
                { label: t('license.fields.people'), value: pending.equipo ? t('license.team', { seats: data.company.seats }) : t('license.solo') },
                {
                  label: t('license.fields.support'),
                  value: pending.soporteHasta > pending.emitida ? formatDate(pending.soporteHasta, loc) : t('license.noSupportShort'),
                },
              ]}
            />
          </Card>
        ) : (
          <Notice role="status">{t('license.preparing')}</Notice>
        )}

        <Card title={t('license.howTitle')} as="h2">
          <ul className="list-disc space-y-2 pl-5">
            <li>{t('license.how.keep')}</li>
            <li>{t('license.how.support')}</li>
            <li>{t('license.how.security')}</li>
            {current?.equipo && <li>{t('license.how.team')}</li>}
          </ul>
        </Card>

        {others.length > 0 && (
          <section>
            <h2 className="text-xl font-semibold text-ink">{t('license.others')}</h2>
            <p className="mt-2 text-body">{t('license.othersText')}</p>
            <ul className="mt-4 divide-y divide-line rounded-2xl border border-line bg-surface">
              {others.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                  <div>
                    <p className="font-mono font-medium text-ink">{l.id}</p>
                    <p className="text-sm text-body">
                      {t('license.issuedOn', { date: formatDate(l.emitida, loc) })} ·{' '}
                      {l.soporteHasta > l.emitida ? t('license.supportUntil', { date: formatDate(l.soporteHasta, loc) }) : t('license.noSupportShort')}
                    </p>
                  </div>
                  {l.revoked ? (
                    <StatusPill tone="danger">{t('license.revoked')}</StatusPill>
                  ) : (
                    <ButtonLink href={href(l.id)} variant="outline" download>
                      {t('license.downloadShort')}
                    </ButtonLink>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </ZoneFrame>
  )
}
