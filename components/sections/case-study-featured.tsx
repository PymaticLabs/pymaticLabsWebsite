import { useTranslations, useLocale } from 'next-intl'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Clock, FileText, CheckCircle2 } from 'lucide-react'

export default function CaseStudyFeatured() {
  const t = useTranslations('cases')
  const tFeatured = useTranslations('cases.featured')
  const locale = useLocale()
  const prefix = locale === 'en' ? '/en' : ''

  const stack = ['Python', 'openpyxl', 'pdfplumber', 'Claude API', 'imaplib']

  return (
    <section className="py-20 bg-white" id="casos">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h2 className="text-3xl sm:text-4xl font-bold text-[#1E3A5F] mb-4">
            {t('title')}
          </h2>
          <p className="text-lg text-[#64748B] max-w-2xl mx-auto">
            {t('subtitle')}
          </p>
        </div>

        <div className="rounded-2xl border-2 border-[#E2E8F0] overflow-hidden">
          <div className="grid grid-cols-1 lg:grid-cols-2">
            {/* Image/Visual */}
            <div className="bg-gradient-to-br from-[#1E3A5F] to-[#162d4a] p-10 flex items-center justify-center">
              <div className="text-white space-y-6 max-w-sm">
                <Badge variant="accent" className="text-sm">
                  {tFeatured('tag')}
                </Badge>
                <h3 className="text-2xl font-bold">{tFeatured('title')}</h3>

                <div className="space-y-4">
                  <div className="flex items-center gap-3 bg-white/10 rounded-lg p-3">
                    <Clock className="h-8 w-8 text-[#F4B860]" />
                    <div>
                      <div className="text-xl font-bold text-[#F4B860]">10h</div>
                      <div className="text-sm text-gray-300">{tFeatured('result1')}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 bg-white/10 rounded-lg p-3">
                    <FileText className="h-8 w-8 text-[#F4B860]" />
                    <div>
                      <div className="text-xl font-bold text-[#F4B860]">167</div>
                      <div className="text-sm text-gray-300">{tFeatured('result2')}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 bg-white/10 rounded-lg p-3">
                    <CheckCircle2 className="h-8 w-8 text-[#F4B860]" />
                    <div>
                      <div className="text-xl font-bold text-[#F4B860]">0</div>
                      <div className="text-sm text-gray-300">{tFeatured('result3')}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Text content */}
            <div className="p-8 lg:p-10 space-y-6">
              <div>
                <h4 className="font-semibold text-[#1E3A5F] mb-2">{tFeatured('challenge')}</h4>
                <p className="text-[#64748B] text-sm leading-relaxed">{tFeatured('challengeText')}</p>
              </div>
              <div>
                <h4 className="font-semibold text-[#1E3A5F] mb-2">{tFeatured('built')}</h4>
                <p className="text-[#64748B] text-sm leading-relaxed">{tFeatured('builtText')}</p>
              </div>
              <div>
                <h4 className="font-semibold text-[#1E3A5F] mb-3">{tFeatured('stack')}</h4>
                <div className="flex flex-wrap gap-2">
                  {stack.map((tech) => (
                    <span
                      key={tech}
                      className="text-xs bg-[#1E3A5F]/10 text-[#1E3A5F] rounded-md px-2 py-1 font-mono"
                    >
                      {tech}
                    </span>
                  ))}
                </div>
              </div>
              <Button variant="default" asChild>
                <Link href={`${prefix}/casos/estacion-servicio-castellon`}>
                  {tFeatured('cta')} →
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
