"use client"

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { CalendarCheck, CircleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// Elegir la sesion que falta del Acompanado (la segunda, o la primera si su hueco se ocupo al pagar)
// entre los huecos libres de Eric y de Sergio. Primero con quien (por defecto, quien dio la primera)
// y luego el dia y la hora, unos pocos dias cada vez para que la lista no sea eterna en el movil.
// Reserva /api/zone/sessions en Cal.com, que vuelve a comprobar en el servidor que quien pide es
// quien compro y que el hueco sigue libre.

export interface SlotDay {
  day: string
  slots: { value: string; time: string; hostId: string; host: string; label: string }[]
}

const DAYS_STEP = 5

export default function SessionPicker({
  companyId,
  days,
  number,
  hosts,
  defaultHost,
}: {
  companyId: string
  days: SlotDay[]
  number: 1 | 2
  hosts: { id: string; name: string }[]
  defaultHost: string | null
}) {
  const t = useTranslations('zone.sessions')
  const router = useRouter()
  const [host, setHost] = useState<string>(defaultHost && hosts.some((h) => h.id === defaultHost) ? defaultHost : 'all')
  const [shown, setShown] = useState(DAYS_STEP)
  const [choice, setChoice] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const filtered = days
    .map((day) => ({ ...day, slots: day.slots.filter((s) => host === 'all' || s.hostId === host) }))
    .filter((day) => day.slots.length > 0)
  const visible = filtered.slice(0, shown)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!choice) {
      setError(t('errors.choose'))
      return
    }
    const [hostId, start] = choice.split('|')
    const label = days.flatMap((d) => d.slots).find((s) => s.value === choice)?.label ?? ''
    setBusy(true)
    try {
      const res = await fetch('/api/zone/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company: companyId, host: hostId, start }),
      })
      if (res.ok) {
        setDone(t('booked', { when: label }))
        // La pagina se vuelve a pintar con las dos sesiones y el aviso arriba (sin el selector).
        const url = new URL(window.location.href)
        url.searchParams.set('reservada', '1')
        window.location.assign(url.toString())
        return
      }
      setError(res.status === 409 ? t('errors.taken') : res.status === 401 ? t('errors.session') : res.status === 403 ? t('errors.forbidden') : t('errors.network'))
      if (res.status === 409) router.refresh()
    } catch {
      setError(t('errors.network'))
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <p role="status" className="flex gap-2 rounded-xl border border-brand/25 bg-brand-soft px-4 py-3 text-base text-ink">
        <CalendarCheck className="mt-0.5 h-5 w-5 shrink-0 text-brand" aria-hidden="true" />
        {done}
      </p>
    )
  }

  const pill = 'flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-line bg-surface px-4 py-2 text-base text-body has-[:checked]:border-brand has-[:checked]:ring-1 has-[:checked]:ring-brand has-[:focus-visible]:outline has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-brand'

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <h2 className="text-xl font-semibold text-ink">{t('chooseTitle', { number })}</h2>

      <fieldset>
        <legend className="text-base font-semibold text-ink">{t('hostLegend')}</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {[...hosts.map((h) => ({ id: h.id, label: t('withHost', { host: h.name }) })), { id: 'all', label: t('hostAny') }].map((option) => (
            <label key={option.id} className={cn(pill, 'px-5')}>
              <input
                type="radio"
                name="persona"
                value={option.id}
                checked={host === option.id}
                onChange={() => {
                  setHost(option.id)
                  setShown(DAYS_STEP)
                  setChoice('')
                }}
                className="h-4 w-4 accent-brand"
              />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-5">
        <legend className="sr-only">{t('slotsLegend')}</legend>
        {visible.length === 0 && <p className="text-base text-body">{t('noSlotsHost')}</p>}
        {visible.map((day) => (
          <div key={day.day}>
            <p className="text-base font-semibold text-ink first-letter:uppercase">{day.day}</p>
            <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
              {day.slots.map((slot) => (
                <label key={slot.value} className={pill}>
                  <input type="radio" name="hueco" value={slot.value} aria-label={slot.label} checked={choice === slot.value} onChange={() => setChoice(slot.value)} className="h-4 w-4 shrink-0 accent-brand" />
                  <span>
                    <strong className="text-ink">{slot.time}</strong>
                    {host === 'all' && <span className="block text-sm">{t('with', { host: slot.host })}</span>}
                  </span>
                </label>
              ))}
            </div>
          </div>
        ))}
        {filtered.length > shown && (
          <Button type="button" variant="outline" onClick={() => setShown((n) => n + DAYS_STEP)}>
            {t('moreDays')}
          </Button>
        )}
      </fieldset>

      <div aria-live="polite" className="empty:mb-0">
        {error && (
          <p role="alert" className="flex gap-2 rounded-xl border border-danger/40 bg-surface px-4 py-3 text-base text-ink">
            <CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-danger" aria-hidden="true" />
            {error}
          </p>
        )}
      </div>
      <Button type="submit" size="lg" disabled={busy}>
        {busy ? t('booking') : t('book')}
      </Button>
    </form>
  )
}
