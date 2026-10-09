import type { MetadataRoute } from 'next'

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://pymaticlabs.com'

  const pages: { path: string; priority: number }[] = [
    { path: '', priority: 1 },
    { path: '/como-funciona', priority: 0.9 },
    { path: '/precios', priority: 0.9 },
    { path: '/seguridad', priority: 0.7 },
    { path: '/contacto', priority: 0.7 },
    { path: '/aviso-legal', priority: 0.2 },
    { path: '/politica-privacidad', priority: 0.2 },
    { path: '/politica-cookies', priority: 0.2 },
  ]

  return pages.flatMap(({ path, priority }) =>
    (['es', 'en'] as const).map((locale) => ({
      url: locale === 'es' ? `${baseUrl}${path || '/'}` : `${baseUrl}/en${path}`,
      lastModified: new Date(),
      changeFrequency: path === '' ? ('weekly' as const) : ('monthly' as const),
      priority,
      alternates: {
        languages: {
          es: `${baseUrl}${path || '/'}`,
          en: `${baseUrl}/en${path}`,
        },
      },
    }))
  )
}
