"use client"

import { useEffect, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { CircleAlert, MailCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { setProfileHint } from '@/lib/zone-profile'

// Entrar en la zona: el correo y, despues, el codigo de un solo uso que llega por correo (Supabase
// Auth, sin contrasenas). La respuesta al pedir el codigo es siempre la misma, tenga o no acceso
// ese correo, y entre codigo y codigo se espera un minuto (lo que pide Supabase a cada correo):
// asi nadie averigua por la zona que correos son clientes.

const RESEND_SECONDS = 60
type ErrorKey = 'email' | 'code' | 'invalid' | 'rateLimited' | 'network'

export default function LoginForm({ returnTo, fakeHint }: { returnTo: string; fakeHint: boolean }) {
  const t = useTranslations('zone.login')
  const locale = useLocale()
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ErrorKey | null>(null)
  const [resent, setResent] = useState(false)
  const [wait, setWait] = useState(0)
  const codeRef = useRef<HTMLInputElement>(null)
  const emailRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (wait <= 0) return
    const timer = setTimeout(() => setWait((s) => s - 1), 1000)
    return () => clearTimeout(timer)
  }, [wait])

  useEffect(() => {
    if (step === 'code') codeRef.current?.focus()
  }, [step])

  async function requestCode() {
    const res = await fetch('/api/zone/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim(), locale }),
    })
    if (!res.ok) throw new Error(String(res.status))
    setWait(RESEND_SECONDS)
  }

  // Demasiadas peticiones seguidas (429): que espere, no que revise su conexion.
  const requestError = (e: unknown): ErrorKey => (e instanceof Error && e.message === '429' ? 'rateLimited' : 'network')

  async function onEmail(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('email')
      emailRef.current?.focus()
      return
    }
    setBusy(true)
    try {
      await requestCode()
      setResent(false)
      setCode('')
      setStep('code')
    } catch (e) {
      setError(requestError(e))
    } finally {
      setBusy(false)
    }
  }

  async function onResend() {
    setError(null)
    setBusy(true)
    try {
      await requestCode()
      setResent(true)
      codeRef.current?.focus()
    } catch (e) {
      setError(requestError(e))
    } finally {
      setBusy(false)
    }
  }

  async function onCode(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const clean = code.replace(/\D/g, '')
    if (!/^\d{6,10}$/.test(clean)) {
      setError('code')
      codeRef.current?.focus()
      return
    }
    setBusy(true)
    try {
      const res = await fetch('/api/zone/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), code: clean }),
      })
      if (res.ok) {
        // Una carga entera: la zona se pinta en el servidor con la sesion recien abierta (y la barra,
        // con la pista, no ensena Entrar mientras pregunta).
        setProfileHint(true)
        window.location.assign(returnTo)
        return
      }
      setError(res.status === 429 ? 'rateLimited' : res.status === 401 || res.status === 400 ? 'invalid' : 'network')
      codeRef.current?.focus()
    } catch {
      setError('network')
    }
    setBusy(false)
  }

  const errorBox = error && (
    <p role="alert" className="flex gap-2 rounded-xl border border-danger/40 bg-surface px-4 py-3 text-base text-ink">
      <CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-danger" aria-hidden="true" />
      {t(`errors.${error}`)}
    </p>
  )

  if (step === 'email') {
    return (
      <form onSubmit={onEmail} noValidate className="space-y-5">
        <div>
          <Label htmlFor="zona-email" className="text-base">
            {t('emailLabel')}
          </Label>
          <Input
            ref={emailRef}
            id="zona-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={error === 'email' || undefined}
            className="mt-2 h-14 text-lg"
          />
        </div>
        {errorBox}
        <Button type="submit" size="lg" className="w-full sm:w-auto" disabled={busy}>
          {busy ? t('sending') : t('send')}
        </Button>
        {fakeHint && <p className="text-sm text-muted">{t('fake')}</p>}
      </form>
    )
  }

  return (
    <form onSubmit={onCode} noValidate className="space-y-5">
      <div aria-live="polite" className="flex gap-3 rounded-xl bg-paper-2 px-4 py-4 text-base text-body">
        <MailCheck className="mt-0.5 h-5 w-5 shrink-0 text-brand" aria-hidden="true" />
        <p>
          <strong className="block text-ink">{resent ? t('resentTitle') : t('sentTitle')}</strong>
          {t('sent', { email: email.trim() })}
        </p>
      </div>
      <div>
        <Label htmlFor="zona-codigo" className="text-base">
          {t('codeLabel')}
        </Label>
        <Input
          ref={codeRef}
          id="zona-codigo"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]*"
          maxLength={14}
          required
          value={code}
          onChange={(e) => setCode(e.target.value)}
          aria-invalid={error === 'code' || error === 'invalid' || undefined}
          aria-describedby="zona-codigo-ayuda"
          className="mt-2 h-14 max-w-xs font-mono text-2xl tracking-[0.3em]"
        />
        <p id="zona-codigo-ayuda" className="mt-2 text-sm text-muted">
          {t('codeHint')}
        </p>
      </div>
      {errorBox}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="lg" disabled={busy}>
          {busy ? t('verifying') : t('verify')}
        </Button>
        <Button type="button" variant="outline" size="lg" onClick={onResend} disabled={busy || wait > 0}>
          {wait > 0 ? t('resendIn', { seconds: wait }) : t('resend')}
        </Button>
      </div>
      <button
        type="button"
        onClick={() => {
          setStep('email')
          setError(null)
          setTimeout(() => emailRef.current?.focus(), 0)
        }}
        className="min-h-11 text-base font-medium text-brand underline underline-offset-4"
      >
        {t('changeEmail')}
      </button>
      {fakeHint && <p className="text-sm text-muted">{t('fake')}</p>}
    </form>
  )
}
