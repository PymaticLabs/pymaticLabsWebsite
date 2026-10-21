import Image from 'next/image'
import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { CalendarClock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { localePath } from '@/lib/i18n'

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
    <section className="pb-20 pt-16 sm:pb-28 sm:pt-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="grid items-center gap-8 rounded-3xl bg-brand-soft px-6 py-10 sm:px-12 sm:py-14 lg:grid-cols-[auto_1fr] lg:gap-14">
          <ul className="flex gap-5">
            {PEOPLE.map((person) => (
              <li key={person.name} className="text-center">
                <Image
                  src={person.photo}
                  alt=""
                  width={112}
                  height={112}
                  className="h-24 w-24 rounded-full border-4 border-surface object-cover shadow-md sm:h-28 sm:w-28"
                />
                <p className="mt-2 text-base font-semibold text-ink">{person.name}</p>
              </li>
            ))}
          </ul>
          <div>
            <h2 className="text-3xl font-bold tracking-tight text-ink sm:text-4xl">{t('title')}</h2>
            <p className="mt-3 max-w-2xl text-lg leading-relaxed text-body">{t('text')}</p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Button size="lg" asChild>
                <Link href={localePath(locale, '/precios')}>{t('cta')}</Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <Link href={localePath(locale, '/contacto')}>{t('contact')}</Link>
              </Button>
            </div>
            <a
              href="https://cal.com/pymaticlabs"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-flex min-h-11 items-center gap-2 text-base font-semibold text-brand underline decoration-1 underline-offset-4 hover:decoration-2"
            >
              <CalendarClock className="h-5 w-5" aria-hidden="true" />
              {t('call')}
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}
