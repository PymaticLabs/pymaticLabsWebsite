import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { generatePageMetadata } from '@/lib/metadata'
import type { LegalDocumentId } from '@/components/legal-document'

/** Metadatos de una pagina legal. Las condiciones y la privacidad del producto no se indexan hasta que las revise el abogado. */
export async function legalMetadata(
  id: LegalDocumentId,
  params: Promise<{ locale: string }>,
  { noindex = false }: { noindex?: boolean } = {}
): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'legal' })
  return generatePageMetadata({
    title: t(`titles.${id}`),
    description: t(`descriptions.${id}`),
    path: `/${id}`,
    locale,
    noindex,
  })
}
