import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CerebroMark } from '@/components/cerebro-icon'
import DemoChat from '@/components/home/demo-chat'
import { formatPrice, modalities } from '@/lib/offer'
import { localePath } from '@/lib/i18n'

// Portada: que es, que hace y cuanto cuesta, en la primera pantalla. Al lado (en el movil, debajo) se ve
// funcionando: una conversacion de ejemplo con su fuente y una tarea que pide permiso.
export default function Hero() {
  const t = useTranslations('home.hero')
  const locale = useLocale()
  const from = Math.min(...modalities.map((m) => m.launchPrice))
  const trust = [t('trustPrice', { price: formatPrice(from, locale) }), t('trustLicense'), t('trustSystems')]

  return (
    // El degradado deja ver el hilo del fondo (ver body::before en globals.css), como en precios y seguridad.
    // El texto va arriba, no centrado en alto con la conversacion (que es mas alta): asi el titular y los
    // botones caben en la primera pantalla tambien en un portatil con el escalado de Windows (unos 640 px).
    <section className="bg-gradient-to-b from-brand-soft/70 to-transparent pb-16 pt-24 sm:pb-24 sm:pt-28">
      <div className="mx-auto grid max-w-6xl items-start gap-12 px-4 sm:px-6 lg:grid-cols-[1.08fr_1fr] lg:gap-14 lg:px-8">
        <div className="lg:pt-6">
          {/* Que es, en una linea (el nombre ya va en la barra, con el sello) */}
          <p className="inline-flex items-center gap-2 rounded-full border border-brand/20 bg-surface/80 px-3.5 py-1.5 text-sm font-semibold text-brand">
            <CerebroMark className="h-4 w-4 shrink-0" />
            {t('badge')}
          </p>
          <h1 className="mt-5 text-[2.6rem] font-bold leading-[1.04] tracking-tight text-ink sm:text-6xl xl:text-[4.1rem]">
            {t('title')}
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-body sm:text-xl">{t('text')}</p>
          {/* En el movil, los dos botones a todo el ancho: faciles de pulsar */}
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Button size="lg" asChild>
              <Link href={localePath(locale, '/precios')}>{t('ctaPrimary')}</Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link href={localePath(locale, '/contacto')}>{t('ctaSecondary')}</Link>
            </Button>
          </div>
          <ul className="mt-7 flex flex-wrap gap-x-6 gap-y-2 text-base text-body">
            {trust.map((item) => (
              <li key={item} className="flex items-center gap-2">
                <Check className="h-5 w-5 shrink-0 text-brand" aria-hidden="true" />
                {item}
              </li>
            ))}
          </ul>
        </div>

        <DemoChat />
      </div>
    </section>
  )
}
