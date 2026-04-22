const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://pymaticlabs.com'

export function getOrganizationSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'Pymatic Labs',
    url: baseUrl,
    logo: `${baseUrl}/logo.png`,
    description: 'Agencia de automatización con IA para pymes españolas.',
    email: 'hola@pymaticlabs.com',
    address: {
      '@type': 'PostalAddress',
      addressCountry: 'ES',
      addressRegion: 'Castellón',
    },
    sameAs: [
      'https://linkedin.com/company/pymaticlabs',
      'https://github.com/pymaticlabs',
    ],
  }
}

export function getWebSiteSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'Pymatic Labs',
    url: baseUrl,
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${baseUrl}/blog?q={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  }
}

interface FAQ {
  question: string
  answer: string
}

export function getFAQSchema(faqs: FAQ[]) {
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

interface Service {
  name: string
  description: string
  url: string
}

export function getServiceSchema(service: Service) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Service',
    name: service.name,
    description: service.description,
    url: service.url,
    provider: {
      '@type': 'Organization',
      name: 'Pymatic Labs',
      url: baseUrl,
    },
    areaServed: {
      '@type': 'Country',
      name: 'Spain',
    },
  }
}

interface ArticleSchemaProps {
  title: string
  description: string
  datePublished: string
  author: string
  url: string
  image?: string
}

export function getArticleSchema(post: ArticleSchemaProps) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: post.title,
    description: post.description,
    datePublished: post.datePublished,
    author: {
      '@type': 'Person',
      name: post.author,
    },
    publisher: {
      '@type': 'Organization',
      name: 'Pymatic Labs',
      url: baseUrl,
    },
    url: post.url,
    image: post.image || `${baseUrl}/og-image.png`,
  }
}

interface BreadcrumbItem {
  name: string
  url: string
}

export function getBreadcrumbSchema(items: BreadcrumbItem[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  }
}
