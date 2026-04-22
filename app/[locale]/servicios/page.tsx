import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { CheckCircle2, Code2, Workflow, Star } from 'lucide-react'
import { getServiceSchema, getFAQSchema } from '@/lib/schemas'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'servicios' })
  return {
    title: t('title'),
    description: t('subtitle'),
  }
}

export default async function ServiciosPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'servicios' })
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://pymaticlabs.com'

  const services = [
    {
      id: 'python',
      icon: Code2,
      title: t('python.title'),
      what: t('python.what'),
      for: t('python.for'),
      forText: t('python.forText'),
      includes: t.raw('python.includesList') as string[],
      examples: t.raw('python.examplesList') as string[],
      price: t('python.price'),
      cta: t('python.cta'),
    },
    {
      id: 'n8n',
      icon: Workflow,
      title: t('n8n.title'),
      what: t('n8n.what'),
      for: t('n8n.for'),
      forText: t('n8n.forText'),
      includes: t.raw('n8n.includesList') as string[],
      examples: t.raw('n8n.examplesList') as string[],
      price: t('n8n.price'),
      cta: t('n8n.cta'),
    },
    {
      id: 'reviews',
      icon: Star,
      title: t('reviews.title'),
      what: t('reviews.what'),
      for: t('reviews.for'),
      forText: t('reviews.forText'),
      includes: t.raw('reviews.includesList') as string[],
      examples: t.raw('reviews.examplesList') as string[],
      price: t('reviews.price'),
      cta: t('reviews.cta'),
    },
  ]

  const faqs = [
    { question: t('faq.q1'), answer: t('faq.a1') },
    { question: t('faq.q2'), answer: t('faq.a2') },
    { question: t('faq.q3'), answer: t('faq.a3') },
  ]

  const faqSchema = getFAQSchema(faqs)

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />
      {services.map((service) => {
        const schema = getServiceSchema({
          name: service.title,
          description: service.what,
          url: `${baseUrl}/${locale === 'en' ? 'en/' : ''}servicios#${service.id}`,
        })
        return (
          <script
            key={service.id}
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
          />
        )
      })}

      <div className="pt-24 pb-20">
        {/* Header */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center mb-16">
          <h1 className="text-4xl sm:text-5xl font-bold text-[#1E3A5F] mb-4">
            {t('title')}
          </h1>
          <p className="text-xl text-[#64748B] max-w-3xl mx-auto">{t('subtitle')}</p>
        </div>

        {/* Service sections */}
        {services.map((service, index) => (
          <section
            key={service.id}
            id={service.id}
            className={`py-16 ${index % 2 === 0 ? 'bg-[#FAFAF9]' : 'bg-white'}`}
          >
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-start">
                <div className="space-y-6">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 bg-[#1E3A5F] rounded-xl flex items-center justify-center">
                      <service.icon className="h-6 w-6 text-white" />
                    </div>
                    <h2 className="text-3xl font-bold text-[#1E3A5F]">{service.title}</h2>
                  </div>
                  <p className="text-lg text-[#64748B]">{service.what}</p>
                  <div>
                    <h3 className="font-semibold text-[#1E3A5F] mb-2">{service.for}</h3>
                    <p className="text-[#64748B]">{service.forText}</p>
                  </div>
                  <div className="bg-[#1E3A5F] text-white rounded-xl p-6">
                    <div className="text-2xl font-bold text-[#F4B860] mb-2">{service.price}</div>
                    <Button variant="accent" size="lg" asChild>
                      <a href="#contacto">{service.cta} →</a>
                    </Button>
                  </div>
                </div>

                <div className="space-y-6">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-[#1E3A5F] text-lg">{service.for === t('python.for') ? t('python.includes') : service.id === 'n8n' ? t('n8n.includes') : t('reviews.includes')}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-2">
                        {service.includes.map((item: string) => (
                          <li key={item} className="flex items-center gap-2 text-sm text-[#64748B]">
                            <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
                            {item}
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle className="text-[#1E3A5F] text-lg">{service.id === 'python' ? 'Ejemplos' : service.id === 'n8n' ? 'Ejemplos' : 'Ejemplos'}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-2">
                        {service.examples.map((item: string) => (
                          <li key={item} className="flex items-start gap-2 text-sm text-[#64748B]">
                            <span className="text-[#F4B860] font-bold mt-0.5">→</span>
                            {item}
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                </div>
              </div>
            </div>
          </section>
        ))}

        {/* FAQ */}
        <section className="py-16 bg-[#FAFAF9]">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-2xl font-bold text-[#1E3A5F] mb-8 text-center">FAQ</h2>
            <Accordion type="single" collapsible>
              {faqs.map((faq, i) => (
                <AccordionItem key={i} value={`faq-${i}`}>
                  <AccordionTrigger className="text-left font-medium text-[#1E3A5F]">
                    {faq.question}
                  </AccordionTrigger>
                  <AccordionContent className="text-[#64748B]">
                    {faq.answer}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        </section>
      </div>
    </>
  )
}
