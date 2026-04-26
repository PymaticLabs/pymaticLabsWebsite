import { useTranslations, useLocale } from 'next-intl'
import { Button } from '@/components/ui/button'

export default function Hero() {
  const t = useTranslations('hero')
  const locale = useLocale()
  const prefix = locale === 'en' ? '/en' : ''

  return (
    <section className="relative min-h-screen flex items-center bg-[#FAFAF9] overflow-hidden pt-16">
      {/* Background decoration */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-[#1E3A5F]/5 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-[#F4B860]/10 rounded-full blur-3xl" />
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
        {/* Text content */}
        <div className="space-y-6">
          <div className="inline-flex items-center gap-2 bg-[#1E3A5F]/10 text-[#1E3A5F] text-sm font-medium px-3 py-1 rounded-full">
            <span className="w-2 h-2 bg-[#F4B860] rounded-full" />
            Pymatic Labs
          </div>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-[#1E3A5F] leading-tight">
            {t('title')}
          </h1>
          <p className="text-lg text-[#475569] leading-relaxed max-w-xl">
            {t('subtitle')}
          </p>
          <div className="flex flex-col sm:flex-row gap-3">
            <Button variant="default" size="lg" asChild>
              <a href="#como-trabajamos">{t('cta1')}</a>
            </Button>
            <Button variant="accent" size="lg" asChild>
              <a href="#contacto">{t('cta2')}</a>
            </Button>
          </div>

          {/* Trust metrics */}
          <div className="flex flex-wrap gap-6 pt-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-[#1E3A5F]">{t('metric1')}</div>
              <div className="text-sm text-[#475569]">{t('metric1sub')}</div>
            </div>
            <div className="w-px bg-[#E2E8F0]" />
            <div className="text-center">
              <div className="text-2xl font-bold text-[#1E3A5F]">{t('metric2')}</div>
              <div className="text-sm text-[#475569]">{t('metric2sub')}</div>
            </div>
            <div className="w-px bg-[#E2E8F0]" />
            <div className="text-center">
              <div className="text-2xl font-bold text-[#1E3A5F]">{t('metric3')}</div>
              <div className="text-sm text-[#475569]">{t('metric3sub')}</div>
            </div>
          </div>
        </div>

        {/* SVG Animation */}
        <div className="hidden lg:flex items-center justify-center">
          <AnimatedNodes />
        </div>
      </div>
    </section>
  )
}

function AnimatedNodes() {
  return (
    <svg
      width="500"
      height="400"
      viewBox="0 0 500 400"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="w-full max-w-lg"
    >
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.4; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.15); }
        }
        @keyframes dash {
          to { stroke-dashoffset: -100; }
        }
        .node { animation: pulse 3s ease-in-out infinite; }
        .node1 { animation-delay: 0s; }
        .node2 { animation-delay: 0.5s; }
        .node3 { animation-delay: 1s; }
        .node4 { animation-delay: 1.5s; }
        .node5 { animation-delay: 2s; }
        .line { stroke-dasharray: 10 5; animation: dash 2s linear infinite; }
      `}</style>

      {/* Lines */}
      <line x1="250" y1="200" x2="120" y2="100" stroke="#1E3A5F" strokeWidth="1.5" strokeOpacity="0.3" className="line" />
      <line x1="250" y1="200" x2="380" y2="100" stroke="#1E3A5F" strokeWidth="1.5" strokeOpacity="0.3" className="line" style={{ animationDelay: '0.3s' }} />
      <line x1="250" y1="200" x2="100" y2="280" stroke="#1E3A5F" strokeWidth="1.5" strokeOpacity="0.3" className="line" style={{ animationDelay: '0.6s' }} />
      <line x1="250" y1="200" x2="400" y2="280" stroke="#1E3A5F" strokeWidth="1.5" strokeOpacity="0.3" className="line" style={{ animationDelay: '0.9s' }} />
      <line x1="250" y1="200" x2="250" y2="50" stroke="#F4B860" strokeWidth="1.5" strokeOpacity="0.5" className="line" style={{ animationDelay: '1.2s' }} />

      {/* Central node */}
      <circle cx="250" cy="200" r="36" fill="#1E3A5F" className="node node1" />
      <text x="250" y="196" textAnchor="middle" fill="white" fontSize="10" fontFamily="monospace">Pymatic</text>
      <text x="250" y="210" textAnchor="middle" fill="#F4B860" fontSize="10" fontFamily="monospace">Labs</text>

      {/* Satellite nodes */}
      <g className="node node2">
        <circle cx="120" cy="100" r="28" fill="#F4B860" />
        <text x="120" y="96" textAnchor="middle" fill="#0F172A" fontSize="8" fontWeight="bold">Facturas</text>
        <text x="120" y="108" textAnchor="middle" fill="#0F172A" fontSize="8">PDF</text>
      </g>

      <g className="node node3">
        <circle cx="380" cy="100" r="28" fill="#1E3A5F" opacity="0.8" />
        <text x="380" y="96" textAnchor="middle" fill="white" fontSize="8">Reseñas</text>
        <text x="380" y="108" textAnchor="middle" fill="#F4B860" fontSize="8">Google</text>
      </g>

      <g className="node node4">
        <circle cx="100" cy="280" r="28" fill="#1E3A5F" opacity="0.8" />
        <text x="100" y="276" textAnchor="middle" fill="white" fontSize="8">Excel</text>
        <text x="100" y="288" textAnchor="middle" fill="#F4B860" fontSize="8">Auto</text>
      </g>

      <g className="node node5">
        <circle cx="400" cy="280" r="28" fill="#F4B860" />
        <text x="400" y="276" textAnchor="middle" fill="#0F172A" fontSize="8" fontWeight="bold">n8n</text>
        <text x="400" y="288" textAnchor="middle" fill="#0F172A" fontSize="8">Flows</text>
      </g>

      <g className="node node1" style={{ animationDelay: '2.5s' }}>
        <circle cx="250" cy="50" r="24" fill="#1E3A5F" opacity="0.6" />
        <text x="250" y="47" textAnchor="middle" fill="white" fontSize="8">Python</text>
        <text x="250" y="59" textAnchor="middle" fill="#F4B860" fontSize="8">AI</text>
      </g>
    </svg>
  )
}
