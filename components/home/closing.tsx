import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { formatPrice, modalities } from '@/lib/offer'
import { localePath } from '@/lib/i18n'

// Cierre de la home: el precio de entrada y "¿Tienes dudas? Habla con ventas".
export default function Closing() {
  const t = useTranslations('home.closing')
  const locale = useLocale()
  const from = Math.min(...modalities.map((m) => m.launchPrice))

  return (
    <section className="pb-20 pt-8 sm:pb-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 grid grid-cols-1 gap-6 md:grid-cols-[1.4fr_1fr]">
        <div className="rounded-3xl bg-ink px-8 py-12 text-white sm:px-12">
          <h2 className="text-4xl sm:text-5xl font-bold tracking-tight">{t('title')}</h2>
          <p className="mt-4 text-lg text-white/75">{t('text')}</p>
          <p className="mt-8 flex items-baseline gap-2">
            <span className="text-lg text-white/70">{t('from')}</span>
            <span className="text-5xl font-bold tracking-tight">{formatPrice(from, locale)}</span>
            <span className="text-sm text-white/60">{t('noVat')}</span>
          </p>
          <Button size="lg" className="mt-8" asChild>
            <Link href={localePath(locale, '/precios')}>{t('cta')}</Link>
          </Button>
        </div>
        <div className="flex flex-col justify-center rounded-3xl bg-brand-soft px-8 py-12 sm:px-10">
          <h2 className="text-3xl font-bold tracking-tight text-ink">{t('doubtsTitle')}</h2>
          <p className="mt-3 text-lg text-body">{t('doubtsText')}</p>
          <Button size="lg" variant="accent" className="mt-8 self-start" asChild>
            <Link href={localePath(locale, '/contacto')}>{t('doubtsCta')}</Link>
          </Button>
        </div>
      </div>
    </section>
  )
}
