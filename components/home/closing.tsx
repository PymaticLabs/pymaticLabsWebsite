import Image from 'next/image'
import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { localePath } from '@/lib/i18n'
import { BOOKING_URL } from '@/app/[locale]/contacto/booking'

const PEOPLE = [
  { name: 'Eric', photo: '/eric.jpg' },
  { name: 'Sergio', photo: '/sergio.jpg' },
]

// Cierre de la home: quienes estan detras, con su cara (con ellos son las sesiones del Acompanado), y las
// salidas: los precios, escribirles o reservar una videollamada.
export default function Closing() {
  const t = useTranslations('home.closing')
  const locale = useLocale()

  return (
    <section id="hablamos" className="bg-paper pb-28 pt-8 sm:pb-40">
      <div data-reveal className="mx-auto max-w-3xl px-4 text-center sm:px-6">
        <ul className="flex justify-center -space-x-4">
          {PEOPLE.map((person) => (
            <li key={person.name}>
              <Image
                src={person.photo}
                alt={person.name}
                width={96}
                height={96}
                className="h-20 w-20 rounded-full border-4 border-paper object-cover shadow-lg sm:h-24 sm:w-24"
              />
            </li>
          ))}
        </ul>
        <h2 className="mt-8 text-[2.75rem] font-bold leading-[1.04] tracking-[-0.04em] text-ink sm:text-7xl">{t('title')}</h2>
        <p className="mx-auto mt-6 max-w-2xl text-xl leading-relaxed text-muted sm:text-2xl sm:leading-relaxed">{t('text')}</p>
        <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button size="lg" className="h-13 w-full px-8 text-[17px] sm:w-auto" asChild>
            <Link href={localePath(locale, '/precios')}>{t('cta')}</Link>
          </Button>
          <Button size="lg" variant="outline" className="h-13 w-full px-8 text-[17px] sm:w-auto" asChild>
            <Link href={localePath(locale, '/contacto')}>{t('contact')}</Link>
          </Button>
        </div>
        <a
          href={BOOKING_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-5 inline-flex min-h-11 items-center gap-0.5 text-[17px] font-medium text-brand hover:underline hover:underline-offset-4"
        >
          {t('call')}
          <ChevronRight className="h-5 w-5" aria-hidden="true" />
        </a>
      </div>
    </section>
  )
}
