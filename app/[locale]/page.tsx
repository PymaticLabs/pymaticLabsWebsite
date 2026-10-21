import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import Hero from '@/components/home/hero'
import Compare from '@/components/home/compare'
import Abilities from '@/components/home/abilities'
import Steps from '@/components/home/steps'
import Privacy from '@/components/home/privacy'
import PricingTeaser from '@/components/home/pricing-teaser'
import Closing from '@/components/home/closing'
import FaqList from '@/components/faq-list'
import { generatePageMetadata } from '@/lib/metadata'
import { getOrganizationSchema, getProductSchema, getWebSiteSchema } from '@/lib/schemas'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'meta' })
  return generatePageMetadata({
    title: { absolute: t('homeTitle') },
    description: t('homeDescription'),
    locale,
  })
}

// La home vende el cerebro a quien no es tecnico, de arriba abajo: que es y verlo funcionar, lo que cambia,
// lo que hace, como se empieza, la privacidad, el precio, las dudas y quienes estan detras.
export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const tMeta = await getTranslations({ locale, namespace: 'meta' })
  const t = await getTranslations({ locale, namespace: 'home.faq' })
  const schemas = [
    getOrganizationSchema(),
    getWebSiteSchema(),
    getProductSchema({ locale, description: tMeta('homeDescription') }),
  ]

  return (
    <>
      {schemas.map((schema) => (
        <script
          key={schema['@type']}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
        />
      ))}
      <Hero />
      <Compare />
      <Abilities />
      <Steps />
      <Privacy />
      <PricingTeaser />
      <FaqList title={t('title')} items={t.raw('items')} className="bg-band py-16 sm:py-24" />
      <Closing />
    </>
  )
}
