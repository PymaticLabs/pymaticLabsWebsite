import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import ZoneFrame, { ZoneClientMessages } from '@/components/zone/zone-frame'
import TeamManager from '@/components/zone/team-manager'
import { Notice, PageTitle } from '@/components/zone/zone-ui'
import { generatePageMetadata } from '@/lib/metadata'
import { loadZone } from '@/lib/zone-page'

// El equipo (solo quien compro, con equipo): quien entra en la zona, hasta las plazas de la licencia.

export const dynamic = 'force-dynamic'

type Params = Promise<{ locale: string }>

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'zone' })
  return generatePageMetadata({ title: t('team.title'), description: t('meta.description'), path: '/zona/equipo', locale, noindex: true })
}

export default async function EquipoPage({ params, searchParams }: { params: Params; searchParams: Promise<{ empresa?: string }> }) {
  const { locale } = await params
  const { empresa } = await searchParams
  setRequestLocale(locale)
  const state = await loadZone(locale, '/zona/equipo', empresa ?? null)
  if (state.status === 'closed') return <ZoneFrame locale={locale} state={state} section="equipo" />

  const t = await getTranslations({ locale, namespace: 'zone' })
  const { data } = state
  const owner = data.role === 'owner'
  const dateFormat = new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'es-ES', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Madrid' })
  // Primero quien compro; luego, por orden de alta.
  const people = [...data.team].sort((a, b) => (a.role === b.role ? a.since.localeCompare(b.since) : a.role === 'owner' ? -1 : 1))

  return (
    <ZoneFrame locale={locale} state={state} section="equipo">
      <PageTitle title={t('team.title')} intro={owner && data.company.seats > 1 ? t('team.intro', { seats: data.company.seats }) : undefined} />
      <div className="mt-8 max-w-3xl space-y-6">
        {!owner ? (
          <Notice>{t('team.memberNote')}</Notice>
        ) : data.company.seats <= 1 ? (
          <Notice>{t('team.solo')}</Notice>
        ) : (
          <>
            <p className="text-lg font-medium text-ink">{t('team.count', { count: people.length, seats: data.company.seats })}</p>
            <ZoneClientMessages>
              <TeamManager
                companyId={data.company.id}
                people={people.map((p) => ({ email: p.email, role: p.role, since: p.since }))}
                seats={data.company.seats}
                sinceLabels={Object.fromEntries(people.map((p) => [p.email, dateFormat.format(new Date(p.since))]))}
              />
            </ZoneClientMessages>
            <Notice>{t('team.how')}</Notice>
          </>
        )}
      </div>
    </ZoneFrame>
  )
}
