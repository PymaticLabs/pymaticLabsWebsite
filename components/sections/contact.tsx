"use client"

import { useState } from 'react'
import { useTranslations } from 'next-intl'
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
import { Mail, MapPin, CheckCircle2 } from 'lucide-react'

export default function Contact() {
  const t = useTranslations('contact')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSuccess, setIsSuccess] = useState(false)
  const [error, setError] = useState('')
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    businessType: '',
    message: '',
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setError('')

    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })
      const data = await res.json()
      if (data.success) {
        setIsSuccess(true)
      } else {
        setError(data.error || t('errorMsg'))
      }
    } catch {
      setError(t('errorMsg'))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <section className="py-20 bg-white" id="contacto">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h2 className="text-3xl sm:text-4xl font-bold text-[#1E3A5F] mb-4">
            {t('title')}
          </h2>
          <p className="text-lg text-[#64748B]">{t('subtitle')}</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 max-w-5xl mx-auto">
          {/* Form */}
          <div>
            {isSuccess ? (
              <div className="flex flex-col items-center justify-center h-full text-center space-y-4 py-12">
                <CheckCircle2 className="h-16 w-16 text-green-500" />
                <h3 className="text-xl font-bold text-[#1E3A5F]">{t('successTitle')}</h3>
                <p className="text-[#64748B]">{t('successMsg')}</p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <Label htmlFor="name">{t('name')}</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    required
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor="email">{t('email')}</Label>
                  <Input
                    id="email"
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    required
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor="phone">{t('phone')}</Label>
                  <Input
                    id="phone"
                    type="tel"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor="businessType">{t('businessType')}</Label>
                  <Select
                    value={formData.businessType}
                    onValueChange={(v) => setFormData({ ...formData, businessType: v })}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(['hosteleria', 'retail', 'servicios', 'industria', 'construccion', 'otro'] as const).map((key) => (
                        <SelectItem key={key} value={key}>
                          {t(`businessOptions.${key}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="message">{t('message')}</Label>
                  <Textarea
                    id="message"
                    rows={4}
                    value={formData.message}
                    onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                    required
                    minLength={20}
                    className="mt-1"
                  />
                </div>
                {error && <p className="text-red-500 text-sm">{error}</p>}
                <Button
                  type="submit"
                  variant="accent"
                  size="lg"
                  className="w-full"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? t('sending') : t('submit')}
                </Button>
              </form>
            )}
          </div>

          {/* Right column */}
          <div className="space-y-8">
            <div className="bg-[#FAFAF9] rounded-xl p-6 space-y-4">
              <h3 className="font-semibold text-[#1E3A5F]">{t('orSchedule')}</h3>
              <Button variant="outline" size="lg" className="w-full border-[#1E3A5F] text-[#1E3A5F] hover:bg-[#1E3A5F] hover:text-white" asChild>
                <a
                  href="https://cal.com/pymaticlabs"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t('scheduleCta')}
                </a>
              </Button>
            </div>

            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <Mail className="h-5 w-5 text-[#1E3A5F]" />
                <div>
                  <span className="text-sm font-medium text-[#64748B]">{t('emailLabel')} </span>
                  <a href="mailto:hola@pymaticlabs.com" className="text-[#1E3A5F] font-medium">
                    hola@pymaticlabs.com
                  </a>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <MapPin className="h-5 w-5 text-[#1E3A5F]" />
                <div>
                  <span className="text-sm font-medium text-[#64748B]">{t('locationLabel')} </span>
                  <span className="text-[#0F172A]">{t('locationValue')}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
