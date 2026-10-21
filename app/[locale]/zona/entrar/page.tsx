import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { KeyRound } from 'lucide-react'
import LoginForm from '@/components/zone/login-form'
import { ZoneClientMessages } from '@/components/zone/zone-frame'
import { zoneAvailable } from '@/lib/delivery/config'
import { getDelivery } from '@/lib/delivery/container'
import { generatePageMetadata } from '@/lib/metadata'
import { localePath } from '@/lib/i18n'
import { zoneUser } from '@/lib/zone-page'
import { safeZoneReturn } from '@/lib/zone-view'

// Entrar en la zona de clientes con el correo y un codigo de un solo uso. Con la sesion ya abierta,
// directamente a la zona.

export const dynamic = 'force-dynamic'

type Params = Promise<{ locale: string }>

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'zone.meta' })
  return generatePageMetadata({ title: t('loginTitle'), description: t('description'), path: '/zona/entrar', locale, noindex: true })
}

export default async function EntrarPage({ params, searchParams }: { params: Params; searchParams: Promise<{ volver?: string }> }) {
  const { locale } = await params
  const { volver } = await searchParams
  setRequestLocale(locale)
  const t = await getTranslations({ locale, namespace: 'zone.login' })
  const returnTo = safeZoneReturn(volver, locale === 'en' ? 'en' : 'es')
  if (await zoneUser()) redirect(returnTo)

  return (
    <section className="pt-32 pb-20">
      <div className="max-w-xl mx-auto px-4 sm:px-6">
        <KeyRound className="h-12 w-12 text-brand" aria-hidden="true" />
        <h1 className="mt-5 text-3xl sm:text-4xl font-bold tracking-tight text-ink">{t('title')}</h1>
        <p className="mt-4 text-lg text-body">{t('intro')}</p>
        <div className="mt-8 rounded-2xl border border-line bg-surface p-6 sm:p-8">
          {/* Antes de montar la venta (sin Supabase), la zona aun no abre: se dice, sin formulario. */}
          {zoneAvailable() ? (
            <ZoneClientMessages>
              <LoginForm returnTo={returnTo} fakeHint={getDelivery().config.adapters.auth === 'fake'} />
            </ZoneClientMessages>
          ) : (
            <p className="text-lg text-body">{t('unavailable')}</p>
          )}
        </div>
        <div className="mt-8 space-y-3 text-base text-body">
          {zoneAvailable() && <p>{t('noEmail')}</p>}
          <p>
            {t('notCustomer')}{' '}
            <Link href={localePath(locale, '/precios')} className="font-medium text-brand underline underline-offset-4">
              {t('notCustomerLink')}
            </Link>
          </p>
        </div>
      </div>
    </section>
  )
}
