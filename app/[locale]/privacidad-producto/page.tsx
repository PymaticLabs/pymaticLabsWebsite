import { setRequestLocale } from 'next-intl/server'
import LegalDocument from '@/components/legal-document'
import { legalMetadata } from '@/lib/legal-page'

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return legalMetadata('privacidad-producto', params, { noindex: true })
}

export default async function PrivacidadProductoPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)
  return <LegalDocument id="privacidad-producto" locale={locale} />
}
