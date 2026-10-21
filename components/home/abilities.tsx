import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import {
  ArrowRight,
  FolderSearch,
  FolderTree,
  GraduationCap,
  ListChecks,
  MessageSquareText,
  Users,
  type LucideIcon,
} from 'lucide-react'
import SectionHeader from '@/components/section-header'
import { localePath } from '@/lib/i18n'

const icons: Record<string, LucideIcon> = {
  answers: MessageSquareText,
  find: FolderSearch,
  tasks: ListChecks,
  learn: GraduationCap,
  order: FolderTree,
  team: Users,
}

interface Ability {
  icon: string
  title: string
  text: string
  example: string
}

// Lo que hace, en seis tarjetas: cada una con lo que se le diria tal cual, para que se vea que basta con
// hablarle. Todas las funciones, en /funciones.
export default function Abilities() {
  const t = useTranslations('home.abilities')
  const locale = useLocale()
  const items = t.raw('items') as Ability[]
  // Las comillas de cada idioma.
  const quote = (text: string) => (locale === 'en' ? `“${text}”` : `«${text}»`)

  return (
    <section className="bg-band py-16 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <SectionHeader title={t('title')} />
        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => {
            const Icon = icons[item.icon] ?? MessageSquareText
            return (
              <li key={item.title} className="flex flex-col rounded-3xl border border-line bg-surface p-6">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-soft">
                  <Icon className="h-6 w-6 text-brand" strokeWidth={1.9} aria-hidden="true" />
                </span>
                <h3 className="mt-4 text-xl font-bold leading-snug text-ink">{item.title}</h3>
                <p className="mt-2 text-base leading-relaxed text-body">{item.text}</p>
                <p className="mt-auto pt-5">
                  <span className="block text-sm text-muted">{t('saying')}</span>
                  <span className="mt-1.5 inline-block rounded-2xl rounded-bl-md bg-brand-soft px-3.5 py-2 text-base text-ink">
                    {quote(item.example)}
                  </span>
                </p>
              </li>
            )
          })}
        </ul>
        <div className="mt-10 text-center">
          <Link
            href={localePath(locale, '/funciones')}
            className="inline-flex min-h-11 items-center gap-1.5 text-base font-semibold text-brand underline decoration-1 underline-offset-4 hover:decoration-2"
          >
            {t('more')}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </section>
  )
}
