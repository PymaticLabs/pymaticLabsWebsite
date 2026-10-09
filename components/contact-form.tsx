"use client"

import { useState } from 'react'
import Link from 'next/link'
import { useTranslations, useLocale } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { CircleCheck } from 'lucide-react'
import { localePath } from '@/lib/i18n'
import { CONTACT_INTERESTS, type ContactInterest } from '@/lib/contact'

export default function ContactForm({ defaultInterest }: { defaultInterest?: ContactInterest }) {
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
    interest: defaultInterest ?? '',
    message: '',
  })

  const update = (field: keyof typeof formData) => (value: string) =>
    setFormData((data) => ({ ...data, [field]: value }))

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
        setError(t('errorMsg'))
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
        <h2 className="text-xl font-bold text-ink">{t('successTitle')}</h2>
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
            className="mt-1"
          />
        </div>
      </div>
      <div>
        <Label htmlFor="interest" id="interest-label">
          {t('interest')}
        </Label>
        <Select value={formData.interest} onValueChange={update('interest')}>
          <SelectTrigger id="interest" aria-labelledby="interest-label" className="mt-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CONTACT_INTERESTS.map((key) => (
              <SelectItem key={key} value={key}>
                {t(`interestOptions.${key}`)}
              </SelectItem>
            ))}
          </SelectContent>
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
          className="mt-1"
        />
      </div>
      {error && (
        <p className="text-red-600 text-sm" role="alert">
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
