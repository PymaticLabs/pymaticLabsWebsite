import type { Metadata } from 'next'

const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://pymaticlabs.com'

/** La imagen al compartir un enlace (WhatsApp, LinkedIn...): el sello, el titular de la home y una pregunta de ejemplo, en cada idioma. */
export function ogImage(locale: string) {
  return locale === 'en' ? '/og-image-en.png' : '/og-image.png'
}

interface PageMetadataOptions {
  title: string | { absolute: string }
  description: string
  path?: string
  locale?: string
  image?: string
  noindex?: boolean
}

export function generatePageMetadata({
  title,
  description,
  path = '',
  locale = 'es',
  image = ogImage(locale),
  noindex = false,
}: PageMetadataOptions): Metadata {
  const url = locale === 'es' ? path || '/' : `/en${path}`
  const plainTitle = typeof title === 'string' ? title : title.absolute

  return {
    title,
    description,
    alternates: {
      canonical: url,
      languages: {
        es: path || '/',
        en: `/en${path}`,
        'x-default': path || '/',
      },
    },
    openGraph: {
      title: plainTitle,
      description,
      url: `${baseUrl}${url}`,
      siteName: 'Pymatic Labs',
      images: [{ url: image, width: 1200, height: 630, alt: plainTitle }],
      locale: locale === 'es' ? 'es_ES' : 'en_US',
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title: plainTitle,
      description,
      images: [image],
    },
    ...(noindex && { robots: { index: false, follow: true } }),
  }
}
