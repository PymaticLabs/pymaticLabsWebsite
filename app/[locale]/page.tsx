import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import Scrolly from '@/components/home/scrolly'
import Closing from '@/components/home/closing'
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
  setRequestLocale(locale)
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
      <div className="pt-16">
        <Scrolly />
      </div>
      <Closing />
    </>
  )
}
