import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import {
  ArchiveRestore,
  BadgeCheck,
  BookOpenCheck,
  FilePlus,
  FileSpreadsheet,
  FileText,
  FolderSearch,
  FolderTree,
  GraduationCap,
  HardDrive,
  HeartPulse,
  History,
  KeyRound,
  ListChecks,
  Lock,
  MessageCircleDashed,
  MessageSquareText,
  Plug,
  ShieldCheck,
  Smartphone,
  UserPlus,
  Users,
  Laptop,
  Files,
  type LucideIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { generatePageMetadata } from '@/lib/metadata'
import { localePath } from '@/lib/i18n'

const icons: Record<string, LucideIcon> = {
  answers: MessageSquareText,
  unknown: MessageCircleDashed,
  history: History,
  find: FolderSearch,
  tasks: ListChecks,
  learn: GraduationCap,
  excel: FileSpreadsheet,
  pdf: FileText,
  connect: Plug,
  read: Files,
  originals: ArchiveRestore,
  order: FolderTree,
  new: FilePlus,
  people: Users,
  locked: Lock,
  invite: UserPlus,
  mobile: Smartphone,
  local: Laptop,
  vault: KeyRound,
  permission: ShieldCheck,
  health: HeartPulse,
  backup: HardDrive,
  updates: BadgeCheck,
}

interface Group {
  title: string
  items: { icon: string; title: string; text: string }[]
}

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
    path: '/funciones',
    locale,
  })
}

export default async function FuncionesPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations({ locale, namespace: 'features' })
  const groups = t.raw('groups') as Group[]
  const specs = t.raw('specs') as [string, string][]

  return (
    <>
      <section className="pt-32 pb-10">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <p className="text-sm font-semibold uppercase tracking-wider text-brand">{t('eyebrow')}</p>
          <h1 className="mt-3 max-w-3xl text-5xl sm:text-6xl font-bold tracking-tight text-ink">{t('title')}</h1>
        </div>
      </section>

      {groups.map((group) => (
        <section key={group.title} className="py-10">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
            <h2 className="mb-6 border-b border-line pb-3 text-2xl font-bold tracking-tight text-ink">{group.title}</h2>
            <div className="grid grid-cols-2 gap-x-5 gap-y-7 sm:gap-x-8 lg:grid-cols-4">
              {group.items.map((item) => {
                const Icon = icons[item.icon] ?? BookOpenCheck
                return (
                  <div key={item.title}>
                    <Icon className="h-7 w-7 text-brand" strokeWidth={1.75} aria-hidden="true" />
                    <h3 className="mt-3 text-base sm:text-lg font-semibold leading-snug text-ink">{item.title}</h3>
                    <p className="mt-1 text-sm sm:text-base text-body">{item.text}</p>
                  </div>
                )
              })}
            </div>
          </div>
        </section>
      ))}

      <section className="mt-10 bg-paper-2 py-16 sm:py-20" id="especificaciones">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
          <h2 className="mb-8 text-3xl sm:text-4xl font-bold tracking-tight text-ink">{t('specsTitle')}</h2>
          <dl className="divide-y divide-line border-y border-line">
            {specs.map(([label, value]) => (
              <div key={label} className="grid grid-cols-1 gap-1 py-4 sm:grid-cols-[200px_1fr] sm:gap-6">
                <dt className="font-semibold text-ink">{label}</dt>
                <dd className="text-body">{value}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-10">
            <Button size="lg" asChild>
              <Link href={localePath(locale, '/precios')}>{t('cta')}</Link>
            </Button>
          </div>
        </div>
      </section>
    </>
  )
}
