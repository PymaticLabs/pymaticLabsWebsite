import Link from 'next/link'
import { useTranslations, useLocale } from 'next-intl'
import {
  ArrowRight,
  FileText,
  FolderOpen,
  GraduationCap,
  HardDrive,
  HeartPulse,
  KeyRound,
  ListChecks,
  MessageSquareText,
  Plug,
  Smartphone,
  type LucideIcon,
} from 'lucide-react'
import SectionHeader from '@/components/section-header'
import { localePath } from '@/lib/i18n'

const icons: Record<string, LucideIcon> = {
  answers: MessageSquareText,
  tasks: ListChecks,
  learn: GraduationCap,
  ingest: FolderOpen,
  pdf: FileText,
  connect: Plug,
  vault: KeyRound,
  backup: HardDrive,
  mobile: Smartphone,
  health: HeartPulse,
}

export default function Features() {
  const t = useTranslations('features')
  const locale = useLocale()
  const items = t.raw('items') as { id: string; title: string; text: string }[]

  return (
    <section className="py-20 sm:py-24 bg-paper-2">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <SectionHeader eyebrow={t('eyebrow')} title={t('title')} subtitle={t('subtitle')} />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {items.map((item) => {
            const Icon = icons[item.id] ?? MessageSquareText
            return (
              <div key={item.id} className="rounded-2xl bg-white border border-line p-6">
                <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-brand-soft">
                  <Icon className="h-5 w-5 text-brand" aria-hidden="true" />
                </div>
                <h3 className="text-lg font-semibold text-ink mb-2">{item.title}</h3>
                <p className="text-body leading-relaxed">{item.text}</p>
              </div>
            )
          })}
        </div>
        <div className="mt-10 text-center">
          <Link
            href={localePath(locale, '/como-funciona')}
            className="inline-flex items-center gap-2 font-semibold text-brand hover:underline underline-offset-4"
          >
            {t('more')}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </section>
  )
}
