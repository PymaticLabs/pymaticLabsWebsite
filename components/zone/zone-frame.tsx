import Link from 'next/link'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages, getTranslations } from 'next-intl/server'
import { Building2 } from 'lucide-react'
import LogoutButton from '@/components/zone/logout-button'
import ZoneNavScroll from '@/components/zone/zone-nav-scroll'
import { localePath } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { sectionPath, zoneSections, type ZoneOverview, type ZoneSection } from '@/lib/zone-view'
import { companyParam, type ZoneState } from '@/lib/zone-page'

// El marco de cada pagina de la zona: de quien es (empresa, correo y papel), las secciones que ve
// esa persona y cerrar la sesion. Con la zona cerrada (devolucion, contracargo o baja), solo el aviso.

/** Los textos de los componentes de cliente de la zona (entrar, equipo, sesiones, cerrar sesion). */
export async function ZoneClientMessages({ children }: { children: React.ReactNode }) {
  const messages = (await getMessages()) as unknown as { zone: Record<string, unknown> }
  const { login, team, sessions, frame } = messages.zone
  return <NextIntlClientProvider messages={{ zone: { login, team, sessions, frame } }}>{children}</NextIntlClientProvider>
}

export default async function ZoneFrame({
  locale,
  state,
  section,
  children,
}: {
  locale: string
  state: ZoneState
  section: ZoneSection
  children?: React.ReactNode
}) {
  const t = await getTranslations({ locale, namespace: 'zone' })

  if (state.status === 'closed') {
    return (
      <Shell>
        <Header locale={locale} email={state.user.email} />
        <div className="mt-10 max-w-2xl rounded-2xl border border-line bg-surface p-6 sm:p-8">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-ink">{t('closed.title')}</h1>
          <p className="mt-4 text-lg text-body">{t('closed.text')}</p>
          <p className="mt-4 text-body">
            {t.rich('closed.help', { email: (chunks) => <a className="font-medium text-brand underline underline-offset-4" href="mailto:info@pymaticlabs.com">{chunks}</a> })}
          </p>
        </div>
      </Shell>
    )
  }

  const { data } = state
  const company = companyParam(data)
  const sections = zoneSections(data)

  return (
    <Shell>
      <Header locale={locale} email={state.user.email} data={data} />
      {data.companies.length > 1 && <CompanySwitcher locale={locale} data={data} label={t('frame.switchCompany')} />}
      <ZoneNavScroll label={t('frame.navLabel')} className="relative mt-6 -mx-4 px-4 sm:mx-0 sm:px-0 overflow-x-auto">
        <ul className="flex gap-2 w-max sm:w-auto sm:flex-wrap pb-1">
          {sections.map((s) => (
            <li key={s}>
              <Link
                href={localePath(locale, sectionPath(s, company))}
                aria-current={s === section ? 'page' : undefined}
                className={cn(
                  'inline-flex min-h-11 items-center rounded-full border px-5 text-base font-medium transition-colors',
                  s === section ? 'border-brand bg-brand text-white' : 'border-field/50 bg-surface text-ink hover:border-brand hover:text-brand'
                )}
              >
                {t(`nav.${s}`)}
              </Link>
            </li>
          ))}
        </ul>
      </ZoneNavScroll>
      <div className="mt-10">{children}</div>
      <p className="mt-14 border-t border-line pt-6 text-body">
        {t.rich('frame.help', { email: (chunks) => <a className="font-medium text-brand underline underline-offset-4" href="mailto:info@pymaticlabs.com">{chunks}</a> })}
      </p>
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <section className="pt-28 pb-20">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">{children}</div>
    </section>
  )
}

async function Header({ locale, email, data }: { locale: string; email: string; data?: ZoneOverview }) {
  const t = await getTranslations({ locale, namespace: 'zone' })
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm font-semibold uppercase tracking-wider text-brand">{t('eyebrow')}</p>
        {data && <p className="mt-2 text-xl font-semibold text-ink break-words">{data.company.name}</p>}
        <p className="mt-1 text-body">
          <span className="break-all">{email}</span>
          {data && (
            <span className="block text-muted sm:inline">
              <span className="hidden sm:inline"> · </span>
              {t(`roles.${data.role}`)}
            </span>
          )}
        </p>
      </div>
      <ZoneClientMessages>
        <LogoutButton />
      </ZoneClientMessages>
    </div>
  )
}

function CompanySwitcher({ locale, data, label }: { locale: string; data: ZoneOverview; label: string }) {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
      <span className="inline-flex items-center gap-1.5 text-muted">
        <Building2 className="h-4 w-4" aria-hidden="true" />
        {label}
      </span>
      {data.companies.map((c) => (
        <Link
          key={c.id}
          href={localePath(locale, sectionPath('inicio', c.id))}
          aria-current={c.id === data.company.id ? 'true' : undefined}
          className={cn(
            'inline-flex min-h-11 items-center rounded-full border px-4',
            c.id === data.company.id ? 'border-brand text-ink font-medium' : 'border-line text-body hover:border-brand'
          )}
        >
          {c.name}
        </Link>
      ))}
    </div>
  )
}
