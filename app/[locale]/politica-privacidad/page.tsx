import { setRequestLocale } from 'next-intl/server'
import LegalDocument from '@/components/legal-document'
import { legalMetadata } from '@/lib/legal-page'

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return legalMetadata('politica-privacidad', params)
}

export default async function PoliticaPrivacidadPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)
  return <LegalDocument id="politica-privacidad" locale={locale} />
}
