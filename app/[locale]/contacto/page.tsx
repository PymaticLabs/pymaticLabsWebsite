import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import Contact from '@/components/sections/contact'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'contacto' })
  return { title: t('title'), description: t('subtitle') }
}

export default async function ContactoPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'contacto' })

  const faqs = [
    { q: t('faq1q'), a: t('faq1a') },
    { q: t('faq2q'), a: t('faq2a') },
    { q: t('faq3q'), a: t('faq3a') },
  ]

  return (
    <div className="pt-16">
      <Contact />

      {/* Mini FAQ */}
      <section className="py-16 bg-[#FAFAF9]">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl font-bold text-[#1E3A5F] mb-8 text-center">
            {t('faqTitle')}
          </h2>
          <Accordion type="single" collapsible>
            {faqs.map((faq, i) => (
              <AccordionItem key={i} value={`faq-${i}`}>
                <AccordionTrigger className="text-left font-medium text-[#1E3A5F]">
                  {faq.q}
                </AccordionTrigger>
                <AccordionContent className="text-[#64748B]">
                  {faq.a}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </section>
    </div>
  )
}
