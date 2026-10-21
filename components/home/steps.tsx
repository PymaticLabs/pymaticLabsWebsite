import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { Info } from 'lucide-react'
import SectionHeader from '@/components/section-header'
import { localePath } from '@/lib/i18n'

// Como se empieza, en tres pasos, y lo que hace falta para usarlo (sin sorpresas despues de comprar).
export default function Steps() {
  const t = useTranslations('home.steps')
  const locale = useLocale()
  const items = t.raw('items') as { title: string; text: string }[]

  return (
    <section className="py-16 sm:py-24" id="como-funciona">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <SectionHeader title={t('title')} subtitle={t('subtitle')} />
        <ol className="grid gap-5 md:grid-cols-3">
          {items.map((item, i) => (
            <li key={item.title} className="rounded-3xl border border-line bg-surface p-6 sm:p-8">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand text-xl font-bold text-white" aria-hidden="true">
                {i + 1}
              </span>
              <h3 className="mt-5 text-xl font-bold text-ink">{item.title}</h3>
              <p className="mt-2 text-base leading-relaxed text-body">{item.text}</p>
            </li>
          ))}
        </ol>
        <p className="mx-auto mt-8 flex max-w-3xl gap-3 rounded-2xl border border-brand/20 bg-surface px-5 py-4 text-base leading-relaxed text-body">
          <Info className="mt-0.5 h-5 w-5 shrink-0 text-brand" aria-hidden="true" />
          <span>
            {t('needs')}{' '}
            <Link
              href={`${localePath(locale, '/funciones')}#especificaciones`}
              className="font-semibold text-brand underline decoration-1 underline-offset-4 hover:decoration-2"
            >
              {t('needsLink')}
            </Link>
          </span>
        </p>
      </div>
    </section>
  )
}
