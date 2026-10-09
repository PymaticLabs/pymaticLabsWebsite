import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { CircleCheck, Mail } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { generatePageMetadata } from '@/lib/metadata'
import { localePath } from '@/lib/i18n'

// A donde vuelve el cliente tras pagar con un enlace de pago de Stripe.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'thanks' })
  return generatePageMetadata({ title: t('title'), description: t('subtitle'), path: '/gracias', locale, noindex: true })
}

export default async function GraciasPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations({ locale, namespace: 'thanks' })
  const steps = t.raw('steps') as string[]

  return (
    <section className="pt-32 pb-20">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <CircleCheck className="mx-auto h-16 w-16 text-brand" aria-hidden="true" />
        <h1 className="mt-6 text-3xl sm:text-4xl font-bold tracking-tight text-ink">{t('title')}</h1>
        <p className="mt-4 text-lg text-body">{t('subtitle')}</p>
        <ul className="mt-8 space-y-3 text-left rounded-2xl bg-paper-2 p-6">
          {steps.map((step) => (
            <li key={step} className="flex gap-3 text-body">
              <Mail className="h-5 w-5 shrink-0 text-brand mt-0.5" aria-hidden="true" />
              {step}
            </li>
          ))}
        </ul>
        <p className="mt-6 text-sm text-muted">{t('help')}</p>
        <div className="mt-8">
          <Button size="lg" asChild>
            <Link href={localePath(locale, '/como-funciona')}>{t('cta')}</Link>
          </Button>
        </div>
      </div>
    </section>
  )
}
