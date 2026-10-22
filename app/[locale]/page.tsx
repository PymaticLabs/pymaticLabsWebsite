import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import Hero from '@/components/home/hero'
import Manifesto from '@/components/home/manifesto'
import Story from '@/components/home/story'
import Bento from '@/components/home/bento'
import Privacy from '@/components/home/privacy'
import Steps from '@/components/home/steps'
import PricingTeaser from '@/components/home/pricing-teaser'
import Faq from '@/components/home/faq'
import Closing from '@/components/home/closing'
import Reveals from '@/components/home/reveals'
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

// La home, como la pagina de un producto: el producto funcionando (la conversacion), lo que pasa hoy en la
// empresa, las tareas contadas con el chat, todo lo que lee, la privacidad, como se empieza, el precio, las
// dudas y quienes estan detras. Cada seccion es una idea, con aire y movimiento con sentido.
export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const tMeta = await getTranslations({ locale, namespace: 'meta' })
  const t = await getTranslations({ locale, namespace: 'home.manifesto' })
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
      <Manifesto problem={t('problem')} promise={t('promise')} />
      <Story />
      <Bento />
      <Privacy />
      <Steps />
      <PricingTeaser />
      <Faq />
      <Closing />
      <Reveals />
    </>
  )
}
