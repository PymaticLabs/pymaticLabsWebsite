import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { ArchiveRestore, ArrowRight, HardDrive, HeartPulse, KeyRound, Laptop, ShieldCheck, type LucideIcon } from 'lucide-react'
import { localePath } from '@/lib/i18n'

const icons: Record<string, LucideIcon> = {
  local: Laptop,
  permission: ShieldCheck,
  originals: ArchiveRestore,
  health: HeartPulse,
  vault: KeyRound,
  backup: HardDrive,
}

// La privacidad, el argumento que mas pesa frente a otras herramientas: en una franja oscura, que se note.
// Lo de Claude va dicho tal cual (la promesa entera y lo que hay detras, en /seguridad).
export default function Privacy() {
  const t = useTranslations('home.privacy')
  const locale = useLocale()
  const items = t.raw('items') as { icon: string; title: string; text: string }[]

  return (
    <section className="bg-inverse py-16 text-white sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl">
          <h2 className="text-3xl font-bold tracking-tight sm:text-5xl">{t('title')}</h2>
          <p className="mt-4 text-lg leading-relaxed text-white/75 sm:text-xl">{t('subtitle')}</p>
        </div>
        <ul className="mt-12 grid gap-x-10 gap-y-9 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => {
            const Icon = icons[item.icon] ?? ShieldCheck
            return (
              <li key={item.title} className="flex gap-4">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/10">
                  <Icon className="h-6 w-6 text-brand-light" strokeWidth={1.9} aria-hidden="true" />
                </span>
                <div>
                  <h3 className="text-lg font-semibold">{item.title}</h3>
                  <p className="mt-1 text-base leading-relaxed text-white/75">{item.text}</p>
                </div>
              </li>
            )
          })}
        </ul>
        <div className="mt-12 flex flex-col gap-4 border-t border-white/15 pt-8 md:flex-row md:items-center md:justify-between md:gap-10">
          <p className="max-w-2xl text-base leading-relaxed text-white/75">{t('claude')}</p>
          <Link
            href={localePath(locale, '/seguridad')}
            className="inline-flex min-h-11 shrink-0 items-center gap-1.5 text-base font-semibold text-brand-light underline decoration-1 underline-offset-4 hover:decoration-2"
          >
            {t('link')}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </section>
  )
}
