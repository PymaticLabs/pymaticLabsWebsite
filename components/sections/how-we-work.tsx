import { useTranslations } from 'next-intl'
import { Phone, FileText, Code, Rocket } from 'lucide-react'

const icons = [Phone, FileText, Code, Rocket]

export default function HowWeWork() {
  const t = useTranslations('howWeWork')

  const steps = [
    { icon: icons[0], titleKey: 'step1title' as const, descKey: 'step1desc' as const },
    { icon: icons[1], titleKey: 'step2title' as const, descKey: 'step2desc' as const },
    { icon: icons[2], titleKey: 'step3title' as const, descKey: 'step3desc' as const },
    { icon: icons[3], titleKey: 'step4title' as const, descKey: 'step4desc' as const },
  ]

  return (
    <section className="py-20 bg-white" id="como-trabajamos">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h2 className="text-3xl sm:text-4xl font-bold text-[#1E3A5F] mb-4">
            {t('title')}
          </h2>
          <p className="text-lg text-[#475569]">{t('subtitle')}</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {steps.map((step, index) => (
            <div key={index} className="relative">
              {/* Connector line (desktop) */}
              {index < steps.length - 1 && (
                <div className="hidden lg:block absolute top-8 left-[calc(50%+2rem)] right-[-50%] h-px bg-[#E2E8F0] z-0" />
              )}
              <div className="relative z-10 flex flex-col items-center text-center space-y-3 p-4">
                <div className="w-16 h-16 bg-[#1E3A5F] rounded-2xl flex items-center justify-center relative">
                  <span className="absolute -top-2 -left-2 w-6 h-6 bg-[#F4B860] rounded-full text-xs font-bold text-[#0F172A] flex items-center justify-center">
                    {index + 1}
                  </span>
                  <step.icon className="h-7 w-7 text-white" />
                </div>
                <h3 className="font-bold text-[#1E3A5F]">{t(step.titleKey)}</h3>
                <p className="text-sm text-[#475569]">{t(step.descKey)}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
