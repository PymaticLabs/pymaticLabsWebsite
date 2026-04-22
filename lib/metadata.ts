import type { Metadata } from 'next'

const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://pymaticlabs.com'

interface PageMetadataOptions {
  title: string
  description: string
  path?: string
  locale?: string
  image?: string
}

export function generatePageMetadata({
  title,
  description,
  path = '',
  locale = 'es',
  image = '/og-image.png',
}: PageMetadataOptions): Metadata {
  const alternateLocale = locale === 'es' ? 'en' : 'es'
  const alternatePath = alternateLocale === 'en' ? `/en${path}` : path

  return {
    title,
    description,
    metadataBase: new URL(baseUrl),
    alternates: {
      canonical: locale === 'es' ? path || '/' : `/en${path}`,
      languages: {
        es: path || '/',
        en: `/en${path}`,
      },
    },
    openGraph: {
      title,
      description,
      url: `${baseUrl}${locale === 'es' ? path : `/en${path}`}`,
      siteName: 'Pymatic Labs',
      images: [
        {
          url: image,
          width: 1200,
          height: 630,
          alt: title,
        },
      ],
      locale: locale === 'es' ? 'es_ES' : 'en_US',
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [image],
    },
  }
}
