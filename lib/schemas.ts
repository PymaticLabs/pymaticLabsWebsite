import { modalities } from '@/lib/offer'

const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://pymaticlabs.com'

export function getOrganizationSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'Pymatic Labs',
    legalName: 'PYMATICLABS, SOCIEDAD LIMITADA',
    taxID: 'B88781745',
    url: baseUrl,
    email: 'info@pymaticlabs.com',
    address: {
      '@type': 'PostalAddress',
      addressLocality: 'Castellón de la Plana',
      postalCode: '12006',
      addressCountry: 'ES',
    },
    sameAs: ['https://linkedin.com/company/pymaticlabs'],
  }
}

export function getWebSiteSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'Pymatic Labs',
    url: baseUrl,
    inLanguage: ['es', 'en'],
  }
}

export function getProductSchema({ locale, description }: { locale: string; description: string }) {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: locale === 'en' ? 'Digital Brain' : 'Cerebro Digital',
    description,
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'macOS, Windows',
    brand: { '@type': 'Brand', name: 'Pymatic Labs' },
    offers: {
      '@type': 'AggregateOffer',
      priceCurrency: 'EUR',
      lowPrice: Math.min(...modalities.map((m) => m.launchPrice)),
      highPrice: Math.max(...modalities.map((m) => m.listPrice)),
      offerCount: modalities.length,
    },
  }
}

export function getFAQSchema(faqs: { question: string; answer: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((faq) => ({
      '@type': 'Question',
      name: faq.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: faq.answer,
      },
    })),
  }
}
