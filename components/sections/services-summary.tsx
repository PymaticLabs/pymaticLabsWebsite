import { useTranslations, useLocale } from 'next-intl'
import Link from 'next/link'
import { Code2, Workflow, Star, ArrowRight } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'

export default function ServicesSummary() {
  const t = useTranslations('services')
  const locale = useLocale()
  const prefix = locale === 'en' ? '/en' : ''

  const services = [
    {
      icon: Code2,
      title: t('s1title'),
      desc: t('s1desc'),
      href: `${prefix}/servicios#python`,
    },
    {
      icon: Workflow,
      title: t('s2title'),
      desc: t('s2desc'),
      href: `${prefix}/servicios#n8n`,
    },
    {
      icon: Star,
      title: t('s3title'),
      desc: t('s3desc'),
      href: `${prefix}/servicios#reviews`,
    },
  ]

  return (
    <section className="py-20 bg-[#FAFAF9]" id="servicios">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h2 className="text-3xl sm:text-4xl font-bold text-[#1E3A5F] mb-4">
            {t('title')}
          </h2>
          <p className="text-lg text-[#475569] max-w-2xl mx-auto">
            {t('subtitle')}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {services.map((service) => (
            <Card
              key={service.href}
              className="hover:shadow-lg transition-all group border-2 hover:border-[#1E3A5F]"
            >
              <CardContent className="p-6 space-y-4">
                <div className="w-12 h-12 bg-[#1E3A5F]/10 rounded-lg flex items-center justify-center group-hover:bg-[#1E3A5F] transition-colors">
                  <service.icon className="h-6 w-6 text-[#1E3A5F] group-hover:text-white transition-colors" />
                </div>
                <h3 className="font-bold text-lg text-[#1E3A5F]">{service.title}</h3>
                <p className="text-sm text-[#475569]">{service.desc}</p>
                <Link
                  href={service.href}
                  className="inline-flex items-center gap-1 text-sm font-medium text-[#1E3A5F] hover:gap-2 transition-all"
                >
                  {t('learnMore')} <ArrowRight className="h-4 w-4" />
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  )
}
