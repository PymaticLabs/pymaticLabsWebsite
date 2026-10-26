import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { ArchiveRestore, ChevronRight, HeartPulse, Laptop, ShieldCheck, type LucideIcon } from 'lucide-react'
import { CEREBRO_PATH } from '@/components/cerebro-icon'
import { localePath } from '@/lib/i18n'

const icons: Record<string, LucideIcon> = {
  local: Laptop,
  permission: ShieldCheck,
  originals: ArchiveRestore,
  health: HeartPulse,
}

// La privacidad, el argumento que mas pesa frente a otras herramientas, en una franja negra de cine: el
// sello se dibuja con su hilo de luz al aparecer y debajo, la promesa en grande. Lo de Claude va dicho tal
// cual (la promesa entera y lo que hay detras, en /seguridad).
export default function Privacy() {
  const t = useTranslations('home.privacy')
  const locale = useLocale()
  const items = t.raw('items') as { icon: string; title: string; text: string }[]

  return (
    <section id="privacidad" className="relative overflow-hidden bg-inverse py-28 text-white sm:py-40">
      <div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-16 h-[28rem] w-[28rem] -translate-x-1/2 rounded-full bg-brand/35 blur-[130px]" />
      <div className="relative mx-auto max-w-6xl px-4 text-center sm:px-6 lg:px-8">
        <div data-reveal="zoom" className="mx-auto w-fit">
          <svg viewBox="6.4 5.1 19.2 22.2" fill="none" aria-hidden="true" className="h-36 w-36 drop-shadow-[0_0_18px_rgb(106_164_255/0.55)] sm:h-44 sm:w-44">
            <defs>
              <linearGradient id="privacy-thread" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#BFDBFE" />
                <stop offset="0.55" stopColor="#6AA4FF" />
                <stop offset="1" stopColor="#2F7BFF" />
              </linearGradient>
            </defs>
            <path
              d={CEREBRO_PATH}
              pathLength={1}
              className="draw-path"
              stroke="url(#privacy-thread)"
              strokeWidth="1.15"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ '--delay': '0.2s' } as React.CSSProperties}
            />
          </svg>
        </div>
        <h2 data-reveal className="mt-10 text-[3rem] font-bold leading-[1.02] tracking-[-0.045em] sm:text-7xl lg:text-8xl">
          {t('title')} <span className="text-gradient">{t('titleAccent')}</span>
        </h2>
        <p data-reveal className="mx-auto mt-6 max-w-2xl text-xl leading-relaxed text-white/70 sm:text-2xl sm:leading-relaxed" style={{ '--delay': '0.1s' } as React.CSSProperties}>
          {t('subtitle')}
        </p>

        <ul className="mt-16 grid gap-x-10 gap-y-10 text-left sm:mt-24 sm:grid-cols-2 lg:grid-cols-4">
          {items.map((item, i) => {
            const Icon = icons[item.icon] ?? ShieldCheck
            return (
              <li key={item.title} data-reveal style={{ '--delay': `${i * 0.1}s` } as React.CSSProperties}>
                <Icon className="h-7 w-7 text-brand-light" strokeWidth={1.7} aria-hidden="true" />
                <h3 className="mt-4 text-xl font-semibold tracking-[-0.01em]">{item.title}</h3>
                <p className="mt-2 text-base leading-relaxed text-white/65">{item.text}</p>
              </li>
            )
          })}
        </ul>

        <div data-reveal className="mt-16 flex flex-col items-center gap-3 border-t border-white/15 pt-10 sm:mt-20">
          <p className="max-w-2xl text-base leading-relaxed text-white/65">{t('claude')}</p>
          <Link
            href={localePath(locale, '/seguridad')}
            className="inline-flex min-h-11 items-center gap-0.5 text-[17px] font-medium text-brand-light hover:underline hover:underline-offset-4"
          >
            {t('link')}
            <ChevronRight className="h-5 w-5" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </section>
  )
}
