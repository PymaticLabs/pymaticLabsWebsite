"use client"

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { CircleAlert, CircleCheck, UserMinus, UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

// El equipo, para quien compro: dar de alta un correo (hasta las plazas de la licencia; le llega el
// acceso por correo) y dar de baja (deja de entrar al momento). Lo hace /api/zone/team, que comprueba
// en el servidor que quien pide es quien compro y que quedan plazas: aqui solo se ensena.

interface Person {
  email: string
  role: 'owner' | 'member'
  since: string
}

type Message = { tone: 'ok' | 'error'; text: string } | null

export default function TeamManager({ companyId, people, seats, sinceLabels }: { companyId: string; people: Person[]; seats: number; sinceLabels: Record<string, string> }) {
  const t = useTranslations('zone.team')
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [message, setMessage] = useState<Message>(null)
  const full = people.length >= seats

  function errorText(status: number) {
    if (status === 400) return t('errors.email')
    if (status === 401) return t('errors.session')
    if (status === 409) return t('errors.full', { seats })
    if (status === 403) return t('errors.forbidden')
    if (status === 429) return t('errors.tooMany')
    return t('errors.network')
  }

  async function call(method: 'POST' | 'DELETE', target: string) {
    const res = await fetch('/api/zone/team', {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company: companyId, email: target }),
    })
    const body = (await res.json().catch(() => ({}))) as { added?: boolean; removed?: boolean }
    return { ok: res.ok, status: res.status, body }
  }

  async function onAdd(e: React.FormEvent) {
    e.preventDefault()
    const target = email.trim().toLowerCase()
    setMessage(null)
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)) {
      setMessage({ tone: 'error', text: t('errors.email') })
      return
    }
    setBusy(true)
    try {
      const res = await call('POST', target)
      if (!res.ok) setMessage({ tone: 'error', text: errorText(res.status) })
      else {
        setMessage({ tone: 'ok', text: res.body.added ? t('added', { email: target }) : t('already', { email: target }) })
        setEmail('')
        router.refresh()
      }
    } catch {
      setMessage({ tone: 'error', text: t('errors.network') })
    } finally {
      setBusy(false)
    }
  }

  async function onRemove(target: string) {
    setMessage(null)
    setBusy(true)
    try {
      const res = await call('DELETE', target)
      if (!res.ok) setMessage({ tone: 'error', text: errorText(res.status) })
      else {
        setMessage({ tone: 'ok', text: t('removed', { email: target }) })
        router.refresh()
      }
    } catch {
      setMessage({ tone: 'error', text: t('errors.network') })
    } finally {
      setConfirming(null)
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
        {people.map((person) => (
          <li key={person.email} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
            <div className="min-w-0">
              <p className="font-medium text-ink break-all">{person.email}</p>
              <p className="text-sm text-body">
                {person.role === 'owner' ? t('owner') : t('member')} · {t('since', { date: sinceLabels[person.email] ?? '' })}
              </p>
            </div>
            {person.role === 'member' &&
              (confirming === person.email ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-ink">{t('confirm')}</span>
                  <Button variant="outline" onClick={() => onRemove(person.email)} disabled={busy} className="border-danger/60 text-danger">
                    {t('confirmYes')}
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirming(null)} disabled={busy}>
                    {t('confirmNo')}
                  </Button>
                </div>
              ) : (
                <Button variant="outline" onClick={() => setConfirming(person.email)} disabled={busy} aria-label={t('removeLabel', { email: person.email })}>
                  <UserMinus className="h-4 w-4" aria-hidden="true" />
                  {t('remove')}
                </Button>
              ))}
          </li>
        ))}
      </ul>

      <div aria-live="polite" className="empty:mb-0">
        {message && (
          <p
            role={message.tone === 'error' ? 'alert' : 'status'}
            className={
              message.tone === 'error'
                ? 'flex gap-2 rounded-xl border border-danger/40 bg-surface px-4 py-3 text-base text-ink'
                : 'flex gap-2 rounded-xl border border-brand/25 bg-brand-soft px-4 py-3 text-base text-ink'
            }
          >
            {message.tone === 'error' ? (
              <CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-danger" aria-hidden="true" />
            ) : (
              <CircleCheck className="mt-0.5 h-5 w-5 shrink-0 text-brand" aria-hidden="true" />
            )}
            {message.text}
          </p>
        )}
      </div>

      <form onSubmit={onAdd} noValidate className="rounded-2xl border border-line bg-surface p-6">
        <h2 className="text-xl font-semibold text-ink">{t('addTitle')}</h2>
        <p className="mt-2 text-base text-body">{full ? t('fullText', { seats }) : t('addText')}</p>
        <div className="mt-4 flex flex-col sm:flex-row sm:items-end gap-3">
          <div className="flex-1">
            <Label htmlFor="equipo-correo" className="text-base">
              {t('emailLabel')}
            </Label>
            <Input
              id="equipo-correo"
              type="email"
              inputMode="email"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={full || busy}
              className="mt-2 h-12 text-lg"
            />
          </div>
          <Button type="submit" size="lg" disabled={full || busy}>
            <UserPlus className="h-5 w-5" aria-hidden="true" />
            {busy ? t('adding') : t('add')}
          </Button>
        </div>
      </form>
    </div>
  )
}
