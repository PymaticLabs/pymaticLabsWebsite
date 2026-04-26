import { useTranslations } from 'next-intl'
import { MapPin } from 'lucide-react'

export default function About() {
  const t = useTranslations('about')

  return (
    <section className="py-20 bg-[#FAFAF9]" id="sobre-nosotros">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h2 className="text-3xl sm:text-4xl font-bold text-[#1E3A5F] mb-4">
            {t('title')}
          </h2>
          <p className="text-lg text-[#475569]">{t('subtitle')}</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl mx-auto">
          {/* Sergio */}
          <div className="flex gap-4">
            <div className="flex-shrink-0 w-16 h-16 bg-[#1E3A5F] rounded-full flex items-center justify-center text-white font-bold text-xl">
              S
            </div>
            <div>
              <h3 className="font-bold text-[#1E3A5F] text-lg">{t('sergioName')}</h3>
              <p className="text-sm text-[#F4B860] font-medium mb-2">{t('sergioRole')}</p>
              <p className="text-sm text-[#475569] leading-relaxed">{t('sergioDesc')}</p>
            </div>
          </div>

          {/* Eric */}
          <div className="flex gap-4">
            <div className="flex-shrink-0 w-16 h-16 bg-[#1E3A5F] rounded-full flex items-center justify-center text-white font-bold text-xl">
              E
            </div>
            <div>
              <h3 className="font-bold text-[#1E3A5F] text-lg">{t('ericName')}</h3>
              <p className="text-sm text-[#F4B860] font-medium mb-2">{t('ericRole')}</p>
              <p className="text-sm text-[#475569] leading-relaxed">{t('ericDesc')}</p>
            </div>
          </div>
        </div>

        <div className="text-center mt-8">
          <div className="inline-flex items-center gap-2 text-[#475569] text-sm">
            <MapPin className="h-4 w-4 text-[#1E3A5F]" />
            {t('location')}
          </div>
        </div>
      </div>
    </section>
  )
}
