import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import Hero from '@/components/home/hero'
import WhatIs from '@/components/home/what-is'
import Features from '@/components/home/features'
import Different from '@/components/home/different'
import PrivacyPromise from '@/components/home/promise'
import HowToBuy from '@/components/home/how-to-buy'
import PricingTeaser from '@/components/home/pricing-teaser'
import FaqList from '@/components/faq-list'
import FinalCta from '@/components/final-cta'
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

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'faq' })
  const tMeta = await getTranslations({ locale, namespace: 'meta' })
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
      <WhatIs />
      <Features />
      <Different />
      <PrivacyPromise />
      <HowToBuy />
      <PricingTeaser />
      <FaqList title={t('title')} items={t.raw('items')} id="faq" />
      <FinalCta />
    </>
  )
}
