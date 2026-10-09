import { cn } from '@/lib/utils'

interface SectionHeaderProps {
  eyebrow?: string
  title: string
  subtitle?: string
  align?: 'center' | 'left'
  as?: 'h1' | 'h2'
  className?: string
}

export default function SectionHeader({
  eyebrow,
  title,
  subtitle,
  align = 'center',
  as: Heading = 'h2',
  className,
}: SectionHeaderProps) {
  return (
    <div className={cn('max-w-3xl mb-12', align === 'center' && 'mx-auto text-center', className)}>
      {eyebrow && (
        <p className="text-sm font-semibold uppercase tracking-wider text-brand mb-3">{eyebrow}</p>
      )}
      <Heading
        className={cn(
          'font-bold tracking-tight text-ink',
          Heading === 'h1' ? 'text-4xl sm:text-5xl' : 'text-3xl sm:text-4xl'
        )}
      >
        {title}
      </Heading>
      {subtitle && <p className="mt-4 text-lg text-body leading-relaxed">{subtitle}</p>}
    </div>
  )
}
