import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getAllPosts, getPostBySlug } from '@/lib/blog'
import { Badge } from '@/components/ui/badge'
import { getArticleSchema, getBreadcrumbSchema } from '@/lib/schemas'

export async function generateStaticParams() {
  const posts = getAllPosts()
  return posts.map((post) => ({ slug: post.slug }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const post = getPostBySlug(slug)
  if (!post) return {}
  return {
    title: post.title,
    description: post.description,
  }
}

// Simple markdown to HTML converter for basic formatting
function renderMarkdown(content: string): string {
  return content
    .replace(/^### (.+)$/gm, '<h3 class="text-xl font-bold text-[#1E3A5F] mt-8 mb-3">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="text-2xl font-bold text-[#1E3A5F] mt-10 mb-4">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="text-3xl font-bold text-[#1E3A5F] mt-10 mb-4">$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`\n]+)`/g, '<code class="bg-gray-100 text-[#1E3A5F] rounded px-1 py-0.5 text-sm font-mono">$1</code>')
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre class="bg-[#0F172A] text-gray-100 p-6 rounded-xl overflow-x-auto text-sm font-mono my-6 leading-relaxed"><code>$2</code></pre>')
    .replace(/^\| (.+) \|$/gm, '<tr>$1</tr>')
    .replace(/^> (.+)$/gm, '<blockquote class="border-l-4 border-[#F4B860] pl-4 italic text-[#64748B] my-4">$1</blockquote>')
    .replace(/^- (.+)$/gm, '<li class="ml-4 text-[#64748B] mb-1">• $1</li>')
    .replace(/^\d+\. (.+)$/gm, '<li class="ml-4 text-[#64748B] mb-1 list-decimal">$1</li>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="text-[#1E3A5F] underline hover:text-[#162d4a]">$1</a>')
    .replace(/\n\n/g, '</p><p class="text-[#64748B] leading-relaxed mb-4">')
    .replace(/^(?!<)(.+)$/gm, '<p class="text-[#64748B] leading-relaxed mb-4">$1</p>')
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>
}) {
  const { locale, slug } = await params
  const post = getPostBySlug(slug)

  if (!post) notFound()

  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://pymaticlabs.com'
  const prefix = locale === 'en' ? '/en' : ''

  const articleSchema = getArticleSchema({
    title: post.title,
    description: post.description,
    datePublished: post.date,
    author: post.author,
    url: `${baseUrl}${prefix}/blog/${post.slug}`,
    image: post.cover,
  })

  const breadcrumb = getBreadcrumbSchema([
    { name: 'Home', url: `${baseUrl}${prefix}` },
    { name: 'Blog', url: `${baseUrl}${prefix}/blog` },
    { name: post.title, url: `${baseUrl}${prefix}/blog/${post.slug}` },
  ])

  const htmlContent = renderMarkdown(post.content)

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }}
      />
      <div className="pt-24 pb-20">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <Link
            href={`${prefix}/blog`}
            className="text-sm text-[#64748B] hover:text-[#1E3A5F] mb-8 inline-block"
          >
            {locale === 'es' ? '← Volver al blog' : '← Back to blog'}
          </Link>

          <div className="mb-8">
            <div className="flex flex-wrap gap-2 mb-4">
              {post.tags.map((tag) => (
                <Badge key={tag} variant="secondary" className="text-xs">
                  {tag}
                </Badge>
              ))}
            </div>
            <h1 className="text-3xl sm:text-4xl font-bold text-[#1E3A5F] mb-4">
              {post.title}
            </h1>
            <p className="text-lg text-[#64748B] mb-4">{post.description}</p>
            <div className="text-sm text-[#64748B]">
              {locale === 'es' ? 'Por' : 'By'} {post.author} · {post.date}
            </div>
          </div>

          <article
            className="prose max-w-none"
            dangerouslySetInnerHTML={{ __html: htmlContent }}
          />

          <div className="mt-12 p-8 bg-[#1E3A5F] rounded-2xl text-center text-white">
            <h3 className="text-xl font-bold mb-2">
              {locale === 'es' ? '¿Te ha resultado útil?' : 'Was this helpful?'}
            </h3>
            <p className="text-gray-300 mb-4 text-sm">
              {locale === 'es'
                ? 'Cuéntanos tu proceso y te preparamos una propuesta gratuita.'
                : 'Tell us your process and we will prepare a free proposal.'}
            </p>
            <a
              href={`${prefix}/contacto`}
              className="inline-block bg-[#F4B860] text-[#0F172A] font-semibold px-6 py-3 rounded-lg hover:bg-[#f0a840] transition-colors"
            >
              {locale === 'es' ? 'Hablar con nosotros →' : 'Talk to us →'}
            </a>
          </div>
        </div>
      </div>
    </>
  )
}
