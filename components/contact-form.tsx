"use client"

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useTranslations, useLocale } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select } from '@/components/ui/select'
import { CircleAlert, CircleCheck } from 'lucide-react'
import { localePath } from '@/lib/i18n'
import { CONTACT_INTERESTS, isContactInterest } from '@/lib/contact'

// La pagina es estatica: el interes que llega en ?interes= (desde los precios) se elige aqui, en el
// navegador. El campo "website" es una trampa para robots: va fuera de la vista y del teclado, y si llega
// relleno el servidor contesta que si sin mandar nada. Los maxLength, los del servidor (CONTACT_MAX de
// app/api/contact/handle.ts, que no se importa aqui: trae zod y la entrega): lo prueba lib/contact-form.test.mts.
export default function ContactForm() {
  const t = useTranslations('contact')
  const locale = useLocale()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSuccess, setIsSuccess] = useState(false)
  const [error, setError] = useState('')
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    company: '',
    phone: '',
    interest: '',
    message: '',
    website: '',
  })
  const successRef = useRef<HTMLHeadingElement>(null)

  const update = (field: keyof typeof formData) => (value: string) =>
    setFormData((data) => ({ ...data, [field]: value }))

  useEffect(() => {
    const interest = new URLSearchParams(window.location.search).get('interes')
    if (isContactInterest(interest)) setFormData((data) => (data.interest ? data : { ...data, interest }))
  }, [])

  // Enviado: el formulario (y su boton, que tenia el foco) desaparece; el foco pasa al titulo del aviso,
  // y asi el lector de pantalla dice que ha salido.
  useEffect(() => {
    if (isSuccess) successRef.current?.focus()
  }, [isSuccess])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setError('')

    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...formData, locale }),
      })
      const data = await res.json()
      if (data.success) {
        setIsSuccess(true)
      } else {
        setError(res.status === 429 ? t('tooManyMsg') : t('errorMsg'))
      }
    } catch {
      setError(t('errorMsg'))
    } finally {
      setIsSubmitting(false)
    }
  }

  if (isSuccess) {
    return (
      <div className="flex flex-col items-center justify-center text-center space-y-4 py-12">
        <CircleCheck className="h-16 w-16 text-brand" aria-hidden="true" />
        <h2 ref={successRef} tabIndex={-1} className="text-xl font-bold text-ink focus:outline-none">
          {t('successTitle')}
        </h2>
        <p className="text-body">{t('successMsg')}</p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label htmlFor="name">{t('name')}</Label>
          <Input
            id="name"
            autoComplete="name"
            value={formData.name}
            onChange={(e) => update('name')(e.target.value)}
            required
            minLength={2}
            maxLength={200}
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor="company">{t('company')}</Label>
          <Input
            id="company"
            autoComplete="organization"
            value={formData.company}
            onChange={(e) => update('company')(e.target.value)}
            maxLength={200}
            className="mt-1"
          />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label htmlFor="email">{t('email')}</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            value={formData.email}
            onChange={(e) => update('email')(e.target.value)}
            required
            maxLength={320}
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor="phone">{t('phone')}</Label>
          <Input
            id="phone"
            type="tel"
            autoComplete="tel"
            value={formData.phone}
            onChange={(e) => update('phone')(e.target.value)}
            maxLength={50}
            className="mt-1"
          />
        </div>
      </div>
      <div>
        <Label htmlFor="interest">{t('interest')}</Label>
        <Select id="interest" value={formData.interest} onChange={(e) => update('interest')(e.target.value)} className="mt-1">
          <option value="">{t('interestPlaceholder')}</option>
          {CONTACT_INTERESTS.map((key) => (
            <option key={key} value={key}>
              {t(`interestOptions.${key}`)}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="message">{t('message')}</Label>
        <Textarea
          id="message"
          rows={5}
          value={formData.message}
          onChange={(e) => update('message')(e.target.value)}
          required
          minLength={20}
          maxLength={5000}
          aria-describedby="message-hint"
          className="mt-1"
        />
        <p id="message-hint" className="mt-1 text-sm text-muted">
          {t('messageHint')}
        </p>
      </div>
      {/* La trampa para robots: fuera de la vista, del teclado y del lector de pantalla. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label htmlFor="website">{t('honeypot')}</label>
        <input
          id="website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={formData.website}
          onChange={(e) => update('website')(e.target.value)}
        />
      </div>
      {error && (
        <p className="flex gap-2 text-base text-danger" role="alert">
          <CircleAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}
      <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? t('sending') : t('submit')}
      </Button>
      <p className="text-xs text-muted">
        {t('privacyNote')}{' '}
        <Link href={localePath(locale, '/politica-privacidad')} className="underline underline-offset-2">
          {t('privacyLink')}
        </Link>
      </p>
    </form>
  )
}
