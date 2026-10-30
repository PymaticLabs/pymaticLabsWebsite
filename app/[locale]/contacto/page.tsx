import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { CalendarClock, Mail, MapPin } from 'lucide-react'
import ContactForm from '@/components/contact-form'
import SectionHeader from '@/components/section-header'
import { Button } from '@/components/ui/button'
import { generatePageMetadata } from '@/lib/metadata'
import { BOOKING_URL } from './booking'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'meta' })
  return generatePageMetadata({
    title: t('contactTitle'),
    description: t('contactDescription'),
    path: '/contacto',
    locale,
  })
}

// Estatica, como las demas: el ?interes= de los precios lo lee el formulario en el navegador.
export default async function ContactoPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations({ locale, namespace: 'contact' })

  return (
    <section className="pt-24 sm:pt-32 pb-20">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <SectionHeader as="h1" title={t('title')} subtitle={t('subtitle')} />

        <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-12 max-w-5xl mx-auto">
          <ContactForm />

          <div className="space-y-8">
            <div className="rounded-2xl bg-paper-2 p-6 space-y-4">
              <h2 className="flex items-center gap-2 font-semibold text-ink">
                <CalendarClock className="h-5 w-5 text-brand" aria-hidden="true" />
                {t('orSchedule')}
              </h2>
              <Button variant="outline" size="lg" className="w-full" asChild>
                <a href={BOOKING_URL} target="_blank" rel="noopener noreferrer">
                  {t('scheduleCta')}
                </a>
              </Button>
            </div>

            <div className="space-y-4 text-sm">
              <p className="flex items-center gap-3">
                <Mail className="h-5 w-5 text-brand" aria-hidden="true" />
                <span className="text-muted">{t('emailLabel')}</span>
                <a href="mailto:info@pymaticlabs.com" className="inline-flex min-h-11 items-center font-medium text-ink hover:text-brand">
                  info@pymaticlabs.com
                </a>
              </p>
              <p className="flex items-center gap-3">
                <MapPin className="h-5 w-5 text-brand" aria-hidden="true" />
                <span className="text-muted">{t('locationLabel')}</span>
                <span className="text-ink">{t('locationValue')}</span>
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
