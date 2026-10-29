// Sin imports con alias (@/...): lo prueba node --test (lib/llms.test.mts), sin compilar.
import { modalities } from './offer.ts'

const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://pymaticlabs.com'

export function getOrganizationSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'Pymatic Labs',
    legalName: 'PYMATICLABS, SOCIEDAD LIMITADA',
    taxID: 'B88781745',
    // El NIF-IVA (alta en el ROI, valido en el VIES): el que piden las empresas de otro pais de la UE.
    vatID: 'ESB88781745',
    url: baseUrl,
    logo: `${baseUrl}/logo.png`,
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

/** launchOpen false (sin plazas de lanzamiento): el precio mas bajo es el de lista. */
export function getProductSchema({ locale, description, launchOpen = true }: { locale: string; description: string; launchOpen?: boolean }) {
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
      lowPrice: Math.min(...modalities.map((m) => (launchOpen ? m.launchPrice : m.listPrice))),
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
