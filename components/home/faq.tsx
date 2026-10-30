import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { ChevronRight } from 'lucide-react'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { getFAQSchema } from '@/lib/schemas'
import { localePath } from '@/lib/i18n'

// Las dudas de siempre: el titulo a la izquierda (se queda a la vista en el ordenador) y las preguntas a
// la derecha, que se abren de una en una. Con su JSON-LD, como las de /precios.
export default function Faq() {
  const t = useTranslations('home.faq')
  const locale = useLocale()
  const items = t.raw('items') as { q: string; a: string }[]
  const schema = getFAQSchema(items.map((item) => ({ question: item.q, answer: item.a })))

  return (
    <section id="preguntas" className="bg-paper py-16 sm:py-36">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />
      <div className="mx-auto grid max-w-6xl gap-8 px-4 sm:gap-10 sm:px-6 lg:grid-cols-[1fr_1.6fr] lg:gap-20 lg:px-8">
        <div data-reveal className="lg:sticky lg:top-28 lg:self-start">
          <h2 className="text-balance text-section font-bold leading-[1.04] tracking-[-0.04em] text-ink sm:text-6xl">{t('title')}</h2>
          <p className="mt-4 text-lg text-muted sm:mt-5">
            {t('other')}{' '}
            <Link href={localePath(locale, '/contacto')} className="inline-flex min-h-11 items-center align-middle font-medium text-brand hover:underline hover:underline-offset-4">
              {t('otherLink')}
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </p>
        </div>
        <div data-reveal style={{ '--delay': '0.1s' } as React.CSSProperties}>
          <Accordion type="single" collapsible className="w-full border-t border-line">
            {items.map((item, i) => (
              <AccordionItem key={item.q} value={`faq-${i}`} className="border-line">
                <AccordionTrigger className="py-5 text-left text-xl font-semibold tracking-[-0.01em] text-ink hover:no-underline sm:py-6 sm:text-[1.375rem]">
                  {item.q}
                </AccordionTrigger>
                <AccordionContent className="pb-6 text-lg leading-relaxed text-muted">{item.a}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </div>
    </section>
  )
}
