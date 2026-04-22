import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { caseStudy } from '@/content/cases/estacion-servicio-castellon'
import { getBreadcrumbSchema } from '@/lib/schemas'

export async function generateStaticParams() {
  return [{ slug: 'estacion-servicio-castellon' }]
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>
}): Promise<Metadata> {
  const { locale, slug } = await params
  if (slug !== 'estacion-servicio-castellon') return {}
  const title = locale === 'es' ? caseStudy.title : caseStudy.titleEn
  return { title }
}

export default async function CaseSlugPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>
}) {
  const { locale, slug } = await params

  if (slug !== 'estacion-servicio-castellon') {
    notFound()
  }

  const prefix = locale === 'en' ? '/en' : ''
  const title = locale === 'es' ? caseStudy.title : caseStudy.titleEn
  const challenge = locale === 'es' ? caseStudy.challenge.es : caseStudy.challenge.en
  const solution = locale === 'es' ? caseStudy.solution.es : caseStudy.solution.en
  const results = locale === 'es' ? caseStudy.results.es : caseStudy.results.en

  const breadcrumb = getBreadcrumbSchema([
    { name: 'Home', url: `https://pymaticlabs.com${prefix}` },
    { name: locale === 'es' ? 'Casos' : 'Cases', url: `https://pymaticlabs.com${prefix}/casos` },
    { name: title, url: `https://pymaticlabs.com${prefix}/casos/${slug}` },
  ])

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }}
      />
      <div className="pt-24 pb-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Back link */}
          <Link
            href={`${prefix}/casos`}
            className="text-sm text-[#64748B] hover:text-[#1E3A5F] mb-8 inline-block"
          >
            ← {locale === 'es' ? 'Volver a casos' : 'Back to cases'}
          </Link>

          {/* Header */}
          <div className="mb-10">
            <div className="flex items-center gap-3 mb-4">
              <Badge variant="default">{locale === 'es' ? caseStudy.sector : caseStudy.sectorEn}</Badge>
              <span className="text-sm text-[#64748B]">{caseStudy.location}</span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-bold text-[#1E3A5F] mb-4">{title}</h1>

            {/* Metrics */}
            <div className="flex flex-wrap gap-4 my-6">
              {caseStudy.metrics.map((m, i) => (
                <div key={i} className="bg-[#1E3A5F] text-white rounded-xl px-5 py-3 text-center">
                  <div className="text-2xl font-bold text-[#F4B860]">{m.value}</div>
                  <div className="text-xs text-gray-300">{locale === 'es' ? m.label : m.labelEn}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Stack */}
          <div className="flex flex-wrap gap-2 mb-8">
            {caseStudy.stack.map((tech) => (
              <span
                key={tech}
                className="text-xs bg-[#1E3A5F]/10 text-[#1E3A5F] rounded-md px-2 py-1 font-mono"
              >
                {tech}
              </span>
            ))}
          </div>

          {/* Content */}
          <div className="prose prose-slate max-w-none space-y-8">
            <div>
              <h2 className="text-2xl font-bold text-[#1E3A5F] mb-3">
                {locale === 'es' ? 'El reto' : 'The challenge'}
              </h2>
              {challenge.split('\n\n').map((p, i) => (
                <p key={i} className="text-[#64748B] leading-relaxed mb-4">{p}</p>
              ))}
            </div>

            <div>
              <h2 className="text-2xl font-bold text-[#1E3A5F] mb-3">
                {locale === 'es' ? 'La solución' : 'The solution'}
              </h2>
              {solution.split('\n\n').map((block, i) => {
                if (block.startsWith('```')) {
                  return null
                }
                return (
                  <p key={i} className="text-[#64748B] leading-relaxed mb-4">
                    {block.replace(/\*\*(.*?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1')}
                  </p>
                )
              })}
            </div>

            {/* Code snippet */}
            <div>
              <h3 className="text-lg font-semibold text-[#1E3A5F] mb-3">
                {locale === 'es' ? 'Extracto de código' : 'Code excerpt'}
              </h3>
              <pre className="bg-[#0F172A] text-gray-100 p-6 rounded-xl overflow-x-auto text-sm font-mono leading-relaxed">
                <code>{caseStudy.codeSnippet}</code>
              </pre>
            </div>

            <div>
              <h2 className="text-2xl font-bold text-[#1E3A5F] mb-3">
                {locale === 'es' ? 'Resultados' : 'Results'}
              </h2>
              {results.split('\n\n').map((p, i) => (
                <p key={i} className="text-[#64748B] leading-relaxed mb-4">
                  {p.replace(/\*\*(.*?)\*\*/g, '$1')}
                </p>
              ))}
            </div>
          </div>

          {/* CTA */}
          <div className="mt-12 p-8 bg-[#1E3A5F] rounded-2xl text-center text-white">
            <h3 className="text-xl font-bold mb-2">
              {locale === 'es' ? '¿Tienes un proceso similar?' : 'Do you have a similar process?'}
            </h3>
            <p className="text-gray-300 mb-4 text-sm">
              {locale === 'es'
                ? 'Cuéntanos y te preparamos una propuesta gratuita.'
                : 'Tell us and we will prepare a free proposal.'}
            </p>
            <a
              href="#contacto"
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
