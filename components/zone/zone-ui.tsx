import Link from 'next/link'
import { CircleAlert, Info } from 'lucide-react'
import { cn } from '@/lib/utils'

// Piezas de las paginas de la zona: titulo, tarjeta, aviso y boton-enlace. Grandes y sencillas: la
// zona la usa quien lleva una empresa, de vez en cuando, y tiene que entenderse a la primera.

export function PageTitle({ title, intro }: { title: string; intro?: React.ReactNode }) {
  return (
    <div className="max-w-3xl">
      <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-ink">{title}</h1>
      {intro && <p className="mt-4 text-lg text-body leading-relaxed">{intro}</p>}
    </div>
  )
}

export function Card({
  icon: Icon,
  title,
  children,
  className,
  as: Heading = 'h2',
}: {
  icon?: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' }>
  title: string
  children: React.ReactNode
  className?: string
  as?: 'h2' | 'h3'
}) {
  return (
    <section className={cn('rounded-2xl border border-line bg-surface p-5 sm:p-7', className)}>
      <Heading className="flex items-center gap-3 text-xl font-semibold text-ink">
        {Icon && (
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-soft">
            <Icon className="h-5 w-5 text-brand" aria-hidden="true" />
          </span>
        )}
        {title}
      </Heading>
      <div className="mt-4 space-y-3 text-base text-body">{children}</div>
    </section>
  )
}

export function Notice({ children, tone = 'info', role }: { children: React.ReactNode; tone?: 'info' | 'warning'; role?: 'status' | 'alert' }) {
  const Icon = tone === 'warning' ? CircleAlert : Info
  return (
    <div
      role={role}
      className={cn(
        'flex gap-3 rounded-xl px-4 py-3 text-base text-ink',
        tone === 'warning' ? 'border border-danger/40 bg-surface' : 'border border-brand/25 bg-brand-soft'
      )}
    >
      <Icon className={cn('mt-0.5 h-5 w-5 shrink-0', tone === 'warning' ? 'text-danger' : 'text-brand')} aria-hidden="true" />
      <div className="space-y-1">{children}</div>
    </div>
  )
}

/** Un enlace con aspecto de boton (las descargas van a /api/zone/*, que las firma al pulsar). */
export function ButtonLink({
  href,
  children,
  variant = 'primary',
  download,
  internal = false,
}: {
  href: string
  children: React.ReactNode
  variant?: 'primary' | 'outline'
  download?: boolean
  /** Una pagina de la web (navegacion de Next); si no, un enlace normal (descargas y rutas de la API). */
  internal?: boolean
}) {
  const className = cn(
    'inline-flex min-h-12 items-center justify-center gap-2 rounded-full px-6 py-2 text-base font-medium transition-colors text-center',
    variant === 'primary' ? 'bg-brand text-white hover:bg-brand-dark' : 'border border-field bg-surface text-ink hover:bg-paper-2'
  )
  if (internal) {
    return (
      <Link href={href} className={className}>
        {children}
      </Link>
    )
  }
  return (
    <a href={href} className={className} download={download || undefined}>
      {children}
    </a>
  )
}

/** Una fila de datos: etiqueta y valor (la licencia, una factura...). */
export function Facts({ items }: { items: { label: string; value: React.ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 sm:grid-cols-[minmax(10rem,auto)_1fr] gap-x-6 gap-y-2">
      {items.map((item) => (
        <div key={item.label} className="contents">
          <dt className="text-muted">{item.label}</dt>
          <dd className="font-medium text-ink break-words">{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}
