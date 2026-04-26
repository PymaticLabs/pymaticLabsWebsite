import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { CheckCircle2, MapPin } from 'lucide-react'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'sobre' })
  return { title: t('title'), description: t('subtitle') }
}

export default async function SobreNosotrosPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'sobre' })

  const tools = locale === 'es'
    ? [
        'Automatización de correo', 'Procesado de PDFs', 'Generación de Excel',
        'Flujos sin código', 'Respuestas con IA', 'Integración de herramientas',
        'Notificaciones automáticas', 'Extracción de datos', 'APIs de Google',
        'Aplicaciones de escritorio', 'Detección de errores', 'Informes automáticos',
      ]
    : [
        'Email automation', 'PDF processing', 'Excel generation',
        'No-code flows', 'AI-powered responses', 'Tool integrations',
        'Automatic notifications', 'Data extraction', 'Google APIs',
        'Desktop applications', 'Error detection', 'Automatic reports',
      ]

  const principles = [t('p1'), t('p2'), t('p3'), t('p4')]

  return (
    <div className="pt-24 pb-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-16">
          <h1 className="text-4xl sm:text-5xl font-bold text-[#1E3A5F] mb-4">
            {t('title')}
          </h1>
          <p className="text-xl text-[#64748B] max-w-3xl mx-auto">{t('subtitle')}</p>
        </div>

        {/* Team */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-16 max-w-4xl mx-auto">
          {[
            { initial: 'S', name: 'Sergio J. Pérez', role: locale === 'es' ? 'Co-fundador · Backend & Automatización' : 'Co-founder · Backend & Automation', desc: locale === 'es' ? 'Ingeniero en Diseño y Desarrollo de Videojuegos por la UJI. Apasionado por la programación, la automatización de procesos y la creación de herramientas que ahorran tiempo real.' : 'Video Game Design and Development Engineer from UJI. Passionate about programming, process automation and building tools that save real time.' },
            { initial: 'E', name: 'Eric Ollé', role: locale === 'es' ? 'Co-fundador · IA & Automatización' : 'Co-founder · AI & Automation', desc: locale === 'es' ? 'Ingeniero en Diseño y Desarrollo de Videojuegos por la UJI. Especializado en integraciones de herramientas, inteligencia artificial y automatización de flujos de negocio.' : 'Video Game Design and Development Engineer from UJI. Specialized in tool integrations, artificial intelligence and business workflow automation.' },
          ].map((person) => (
            <div key={person.initial} className="flex gap-5">
              <div className="flex-shrink-0 w-20 h-20 bg-[#1E3A5F] rounded-2xl flex items-center justify-center text-white font-bold text-2xl">
                {person.initial}
              </div>
              <div>
                <h2 className="font-bold text-[#1E3A5F] text-xl">{person.name}</h2>
                <p className="text-sm text-[#7A5C2E] font-medium mb-2">{person.role}</p>
                <p className="text-sm text-[#64748B] leading-relaxed">{person.desc}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 text-[#64748B]">
            <MapPin className="h-4 w-4 text-[#1E3A5F]" />
            {locale === 'es' ? 'Basados en Castellón, trabajamos con toda España.' : 'Based in Castellón, we work with all of Spain.'}
          </div>
        </div>

        {/* Story + Methodology */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 mb-16">
          <div>
            <h2 className="text-2xl font-bold text-[#1E3A5F] mb-4">{t('story')}</h2>
            <p className="text-[#64748B] leading-relaxed">{t('storyText')}</p>
          </div>
          <div>
            <h2 className="text-2xl font-bold text-[#1E3A5F] mb-4">{t('methodology')}</h2>
            <p className="text-[#64748B] leading-relaxed">{t('methodologyText')}</p>
          </div>
        </div>

        {/* Principles */}
        <div className="mb-16">
          <h2 className="text-2xl font-bold text-[#1E3A5F] mb-6">{t('principles')}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {principles.map((p, i) => (
              <div key={i} className="flex items-start gap-3">
                <CheckCircle2 className="h-5 w-5 text-[#7A5C2E] flex-shrink-0 mt-0.5" />
                <span className="text-[#64748B]">{p}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Tools */}
        <div>
          <h2 className="text-2xl font-bold text-[#1E3A5F] mb-6">{t('tools')}</h2>
          <div className="flex flex-wrap gap-2">
            {tools.map((tool) => (
              <span
                key={tool}
                className="text-sm bg-[#1E3A5F]/10 text-[#1E3A5F] rounded-lg px-3 py-1.5 font-mono"
              >
                {tool}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
