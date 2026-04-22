import type { MetadataRoute } from 'next'
import { getAllPosts } from '@/lib/blog'

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://pymaticlabs.com'

  const staticPages = [
    '',
    '/servicios',
    '/casos',
    '/casos/estacion-servicio-castellon',
    '/blog',
    '/sobre-nosotros',
    '/contacto',
    '/aviso-legal',
    '/politica-privacidad',
    '/politica-cookies',
  ]

  const locales = ['es', 'en']

  const staticEntries: MetadataRoute.Sitemap = []

  for (const page of staticPages) {
    for (const locale of locales) {
      const url = locale === 'es' ? `${baseUrl}${page || '/'}` : `${baseUrl}/en${page || '/'}`
      staticEntries.push({
        url,
        lastModified: new Date(),
        changeFrequency: page === '' ? 'weekly' : 'monthly',
        priority: page === '' ? 1 : 0.8,
      })
    }
  }

  // Blog posts
  let posts: MetadataRoute.Sitemap = []
  try {
    const allPosts = getAllPosts()
    posts = allPosts.flatMap((post) =>
      locales.map((locale) => ({
        url:
          locale === 'es'
            ? `${baseUrl}/blog/${post.slug}`
            : `${baseUrl}/en/blog/${post.slug}`,
        lastModified: new Date(post.date),
        changeFrequency: 'monthly' as const,
        priority: 0.7,
      }))
    )
  } catch {
    // posts directory might not exist
  }

  return [...staticEntries, ...posts]
}
