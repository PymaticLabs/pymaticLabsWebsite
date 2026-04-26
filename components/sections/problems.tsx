import { useTranslations } from 'next-intl'
import { Mail, Star, FileSpreadsheet, Calculator } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'

const problems = [
  { icon: Mail, key: 'p1' },
  { icon: Star, key: 'p2' },
  { icon: FileSpreadsheet, key: 'p3' },
  { icon: Calculator, key: 'p4' },
] as const

export default function Problems() {
  const t = useTranslations('problems')

  return (
    <section className="py-20 bg-white" id="problemas">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h2 className="text-3xl sm:text-4xl font-bold text-[#1E3A5F] mb-4">
            {t('title')}
          </h2>
          <p className="text-lg text-[#475569] max-w-2xl mx-auto">
            {t('subtitle')}
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          {problems.map(({ icon: Icon, key }) => (
            <Card key={key} className="hover:shadow-md transition-shadow">
              <CardContent className="p-6 flex items-start gap-4">
                <div className="flex-shrink-0 w-12 h-12 bg-[#1E3A5F]/10 rounded-lg flex items-center justify-center">
                  <Icon className="h-6 w-6 text-[#1E3A5F]" />
                </div>
                <div>
                  <h3 className="font-semibold text-[#1E3A5F] mb-2">
                    {t(`${key}title` as 'p1title' | 'p2title' | 'p3title' | 'p4title')}
                  </h3>
                  <p className="text-sm text-[#475569]">
                    {t(`${key}desc` as 'p1desc' | 'p2desc' | 'p3desc' | 'p4desc')}
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  )
}
