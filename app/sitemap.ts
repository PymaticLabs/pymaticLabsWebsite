import type { MetadataRoute } from 'next'
import { LEGAL_VERSIONS, type LegalDocumentId } from '@/lib/legal-versions'

// Las paginas legales llevan la fecha de su version publicada; las demas, ninguna: una fecha que no es
// la del ultimo cambio de verdad (la del despliegue) hace que los buscadores dejen de fiarse de todas.
// x-default, como en el <head> de cada pagina (lib/metadata.ts): la de castellano.
export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://pymaticlabs.com'

  const pages: { path: string; priority: number; legal?: LegalDocumentId }[] = [
    { path: '', priority: 1 },
    { path: '/funciones', priority: 0.9 },
    { path: '/precios', priority: 0.9 },
    { path: '/seguridad', priority: 0.7 },
    { path: '/contacto', priority: 0.7 },
    { path: '/aviso-legal', priority: 0.2, legal: 'aviso-legal' },
    { path: '/politica-privacidad', priority: 0.2, legal: 'politica-privacidad' },
    { path: '/politica-cookies', priority: 0.2, legal: 'politica-cookies' },
  ]

  return pages.flatMap(({ path, priority, legal }) =>
    (['es', 'en'] as const).map((locale) => ({
      url: locale === 'es' ? `${baseUrl}${path || '/'}` : `${baseUrl}/en${path}`,
      ...(legal ? { lastModified: LEGAL_VERSIONS[legal] } : {}),
      changeFrequency: path === '' ? ('weekly' as const) : ('monthly' as const),
      priority,
      alternates: {
        languages: {
          es: `${baseUrl}${path || '/'}`,
          en: `${baseUrl}/en${path}`,
          'x-default': `${baseUrl}${path || '/'}`,
        },
      },
    }))
  )
}
