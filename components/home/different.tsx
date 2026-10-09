import { useTranslations } from 'next-intl'
import { Hand, InfinityIcon, Languages, Lock, Terminal, Users, type LucideIcon } from 'lucide-react'
import SectionHeader from '@/components/section-header'

const icons: Record<string, LucideIcon> = {
  noTerminal: Terminal,
  local: Lock,
  spain: Languages,
  team: Users,
  permissions: Hand,
  yours: InfinityIcon,
}

export default function Different() {
  const t = useTranslations('different')
  const items = t.raw('items') as { id: string; title: string; text: string }[]

  return (
    <section className="py-20 sm:py-24">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <SectionHeader eyebrow={t('eyebrow')} title={t('title')} />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-10 gap-y-10">
          {items.map((item) => {
            const Icon = icons[item.id] ?? Lock
            return (
              <div key={item.id} className="flex gap-4">
                <Icon className="h-6 w-6 shrink-0 text-brand mt-0.5" aria-hidden="true" />
                <div>
                  <h3 className="text-lg font-semibold text-ink mb-1.5">{item.title}</h3>
                  <p className="text-body leading-relaxed">{item.text}</p>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
