import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { localePath } from '@/lib/i18n'

// Como se empieza, en tres pasos unidos por el hilo (se tiende de uno a otro al aparecer), y lo que hace
// falta para usarlo: sin sorpresas despues de comprar.
export default function Steps() {
  const t = useTranslations('home.steps')
  const locale = useLocale()
  const items = t.raw('items') as { title: string; text: string }[]

  return (
    <section id="empezar" className="bg-paper py-24 sm:py-36">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div data-reveal className="mx-auto max-w-3xl text-center">
          <h2 className="text-[2.75rem] font-bold leading-[1.04] tracking-[-0.04em] text-ink sm:text-7xl">{t('title')}</h2>
          <p className="mt-5 text-xl leading-relaxed text-muted sm:text-2xl">{t('subtitle')}</p>
        </div>

        <div data-reveal className="relative mt-16 sm:mt-20">
          {/* El hilo que une los tres pasos, por detras de los numeros */}
          <div aria-hidden="true" className="absolute left-[16.67%] right-[16.67%] top-8 hidden h-0.5 md:block">
            <div className="grow-x h-full w-full rounded-full bg-gradient-to-r from-brand/20 via-brand/60 to-brand/20" style={{ '--d': '0.3s' } as React.CSSProperties} />
          </div>
          <ol className="relative grid gap-14 md:grid-cols-3 md:gap-10">
            {items.map((item, i) => (
              <li key={item.title} className="enter text-center" style={{ '--d': `${0.15 + i * 0.2}s` } as React.CSSProperties}>
                <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-paper text-3xl font-bold ring-2 ring-brand/25">
                  <span className="text-gradient">{i + 1}</span>
                </span>
                <h3 className="mt-6 text-2xl font-bold tracking-[-0.02em] text-ink sm:text-[1.75rem]">{item.title}</h3>
                <p className="mx-auto mt-3 max-w-xs text-lg leading-relaxed text-muted">{item.text}</p>
              </li>
            ))}
          </ol>
        </div>

        <p data-reveal className="mx-auto mt-16 max-w-2xl text-center text-base leading-relaxed text-muted">
          {t('needs')}{' '}
          <Link
            href={`${localePath(locale, '/funciones')}#especificaciones`}
            className="font-medium text-brand underline decoration-1 underline-offset-4 hover:decoration-2"
          >
            {t('needsLink')}
          </Link>
        </p>
      </div>
    </section>
  )
}
