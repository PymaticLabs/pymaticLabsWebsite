import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Check, MessageSquareText, ListChecks, ShieldAlert } from 'lucide-react'
import SectionHeader from '@/components/section-header'
import FinalCta from '@/components/final-cta'
import { Button } from '@/components/ui/button'
import { generatePageMetadata } from '@/lib/metadata'
import { localePath } from '@/lib/i18n'

type Item = { title: string; text: string }

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'meta' })
  return generatePageMetadata({
    title: t('howTitle'),
    description: t('howDescription'),
    path: '/como-funciona',
    locale,
  })
}

export default async function ComoFuncionaPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations({ locale, namespace: 'howItWorks' })

  const askExamples = t.raw('talk.askExamples') as string[]
  const doExamples = t.raw('talk.doExamples') as string[]
  const permissions = t.raw('permissions.items') as Item[]
  const capabilities = t.raw('capabilities.items') as Item[]
  const never = t.raw('never.items') as Item[]
  const setupSteps = t.raw('setup.steps') as string[]

  return (
    <>
      <section className="pt-32 pb-16 bg-gradient-to-b from-brand-soft to-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeader
            as="h1"
            eyebrow={t('eyebrow')}
            title={t('title')}
            subtitle={t('subtitle')}
            className="mb-0"
          />
        </div>
      </section>

      {/* Como se le habla */}
      <section className="py-16 sm:py-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeader title={t('talk.title')} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <ExampleCard
              icon={<MessageSquareText className="h-5 w-5 text-brand" aria-hidden="true" />}
              title={t('talk.askTitle')}
              text={t('talk.askText')}
              examples={askExamples}
            />
            <ExampleCard
              icon={<ListChecks className="h-5 w-5 text-brand" aria-hidden="true" />}
              title={t('talk.doTitle')}
              text={t('talk.doText')}
              examples={doExamples}
            />
          </div>
        </div>
      </section>

      {/* Permisos */}
      <section className="py-16 sm:py-20 bg-paper-2">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeader title={t('permissions.title')} subtitle={t('permissions.subtitle')} />
          <ol className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {permissions.map((item, i) => (
              <li key={item.title} className="rounded-2xl bg-white border border-line p-6">
                <span className="mb-4 inline-flex h-9 w-9 items-center justify-center rounded-full bg-brand text-white font-semibold">
                  {i + 1}
                </span>
                <h3 className="text-lg font-semibold text-ink mb-2">{item.title}</h3>
                <p className="text-body leading-relaxed">{item.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Todo lo que sabe hacer */}
      <section className="py-16 sm:py-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeader title={t('capabilities.title')} />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-10 gap-y-8">
            {capabilities.map((item) => (
              <div key={item.title} className="border-t-2 border-brand pt-4">
                <h3 className="text-lg font-semibold text-ink mb-2">{item.title}</h3>
                <p className="text-body leading-relaxed">{item.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Lo que nunca hace */}
      <section className="py-16 sm:py-20 bg-ink text-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl mx-auto text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">{t('never.title')}</h2>
            <p className="mt-4 text-lg text-white/75">{t('never.subtitle')}</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {never.map((item) => (
              <div key={item.title} className="flex gap-4 rounded-2xl border border-white/15 p-6">
                <ShieldAlert className="h-6 w-6 shrink-0 text-brand-light" aria-hidden="true" />
                <div>
                  <h3 className="text-lg font-semibold mb-1.5">{item.title}</h3>
                  <p className="text-white/75 leading-relaxed">{item.text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Como se monta */}
      <section className="py-16 sm:py-20">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeader title={t('setup.title')} />
          <ol className="space-y-4">
            {setupSteps.map((step, i) => (
              <li key={step} className="flex gap-4 items-start">
                <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand font-semibold">
                  {i + 1}
                </span>
                <p className="text-lg text-body pt-0.5">{step}</p>
              </li>
            ))}
          </ol>
          <p className="mt-8 rounded-2xl bg-paper-2 p-5 text-body">{t('setup.guides')}</p>
          <div className="mt-10 text-center">
            <Button size="lg" asChild>
              <Link href={localePath(locale, '/precios')}>{t('cta')}</Link>
            </Button>
          </div>
        </div>
      </section>

      <FinalCta />
    </>
  )
}

function ExampleCard({
  icon,
  title,
  text,
  examples,
}: {
  icon: React.ReactNode
  title: string
  text: string
  examples: string[]
}) {
  return (
    <div className="rounded-2xl border border-line p-6 sm:p-8">
      <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-brand-soft">{icon}</div>
      <h3 className="text-xl font-semibold text-ink mb-2">{title}</h3>
      <p className="text-body leading-relaxed mb-5">{text}</p>
      <ul className="space-y-2">
        {examples.map((example) => (
          <li key={example} className="flex gap-2 text-ink">
            <Check className="h-4 w-4 shrink-0 text-brand mt-1" aria-hidden="true" />
            <span className="italic">“{example}”</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
