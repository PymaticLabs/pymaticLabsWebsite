import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { localePath } from '@/lib/i18n'

// Como se empieza, en tres pasos unidos por el hilo (se tiende de uno a otro al aparecer), y lo que hace
// falta para usarlo: sin sorpresas despues de comprar. En el movil, los pasos van uno bajo otro, con el
// numero a la izquierda y el hilo bajando de uno al siguiente: se leen de un vistazo, alineados a la izquierda.
export default function Steps() {
  const t = useTranslations('home.steps')
  const locale = useLocale()
  const items = t.raw('items') as { title: string; text: string }[]

  return (
    <section id="empezar" className="bg-paper py-16 sm:py-36">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div data-reveal className="mx-auto max-w-3xl text-center">
          <h2 className="text-balance text-section font-bold leading-[1.04] tracking-[-0.04em] text-ink sm:text-7xl">{t('title')}</h2>
          <p className="mt-5 text-pretty text-xl leading-relaxed text-muted sm:text-2xl">{t('subtitle')}</p>
        </div>

        <div data-reveal className="relative mx-auto mt-10 max-w-md sm:mt-20 md:max-w-none">
          {/* El hilo que une los tres pasos, por detras de los numeros */}
          <div aria-hidden="true" className="absolute left-[16.67%] right-[16.67%] top-8 hidden h-0.5 md:block">
            <div className="grow-x h-full w-full rounded-full bg-gradient-to-r from-brand/20 via-brand/60 to-brand/20" style={{ '--d': '0.3s' } as React.CSSProperties} />
          </div>
          <ol className="relative grid gap-8 md:grid-cols-3 md:gap-10">
            {items.map((item, i) => (
              <li
                key={item.title}
                className="enter relative grid grid-cols-[3rem_1fr] gap-x-5 before:absolute before:-bottom-6 before:left-6 before:top-14 before:w-0.5 before:-translate-x-1/2 before:rounded-full before:bg-brand/25 last:before:hidden md:block md:text-center md:before:hidden"
                style={{ '--d': `${0.15 + i * 0.2}s` } as React.CSSProperties}
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-paper text-2xl font-bold ring-2 ring-brand/25 md:mx-auto md:h-16 md:w-16 md:text-3xl">
                  <span className="text-gradient">{i + 1}</span>
                </span>
                <div>
                  <h3 className="mt-2 text-2xl font-bold tracking-[-0.02em] text-ink sm:text-[1.75rem] md:mt-6">{item.title}</h3>
                  <p className="mt-2 text-pretty text-lg leading-relaxed text-muted md:mx-auto md:mt-3 md:max-w-xs">{item.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <p data-reveal className="mx-auto mt-12 max-w-md text-pretty text-base leading-relaxed text-muted sm:mt-16 md:max-w-2xl md:text-center">
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
