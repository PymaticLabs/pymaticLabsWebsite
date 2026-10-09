import { useTranslations } from 'next-intl'
import SectionHeader from '@/components/section-header'

export default function HowToBuy() {
  const t = useTranslations('howToBuy')
  const steps = t.raw('steps') as { title: string; text: string }[]

  return (
    <section className="py-20 sm:py-24">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <SectionHeader eyebrow={t('eyebrow')} title={t('title')} />
        <ol className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {steps.map((step, i) => (
            <li key={step.title} className="relative rounded-2xl border border-line p-6">
              <span className="mb-4 inline-flex h-9 w-9 items-center justify-center rounded-full bg-brand text-white font-semibold">
                {i + 1}
              </span>
              <h3 className="text-lg font-semibold text-ink mb-2">{step.title}</h3>
              <p className="text-body leading-relaxed">{step.text}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
