import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { getAllPosts } from '@/lib/blog'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'blog' })
  return { title: t('title'), description: t('subtitle') }
}

export default async function BlogPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'blog' })
  const posts = getAllPosts()
  const prefix = locale === 'en' ? '/en' : ''

  return (
    <div className="pt-24 pb-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h1 className="text-4xl sm:text-5xl font-bold text-[#1E3A5F] mb-4">
            {t('title')}
          </h1>
          <p className="text-xl text-[#64748B] max-w-3xl mx-auto">{t('subtitle')}</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {posts.map((post) => (
            <Card key={post.slug} className="hover:shadow-lg transition-shadow">
              <CardContent className="p-6 space-y-4">
                <div className="flex flex-wrap gap-2">
                  {post.tags.slice(0, 2).map((tag) => (
                    <Badge key={tag} variant="secondary" className="text-xs">
                      {tag}
                    </Badge>
                  ))}
                </div>
                <h2 className="font-bold text-[#1E3A5F] text-lg leading-tight">
                  {post.title}
                </h2>
                <p className="text-sm text-[#64748B] line-clamp-3">{post.description}</p>
                <div className="flex items-center justify-between pt-2">
                  <div className="text-xs text-[#64748B]">
                    {t('by')} {post.author} · {post.date}
                  </div>
                  <Link
                    href={`${prefix}/blog/${post.slug}`}
                    className="text-sm font-medium text-[#1E3A5F] hover:underline"
                  >
                    {t('readMore')}
                  </Link>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {posts.length === 0 && (
          <div className="text-center py-12 text-[#64748B]">
            {locale === 'es' ? 'No hay artículos todavía.' : 'No articles yet.'}
          </div>
        )}
      </div>
    </div>
  )
}
