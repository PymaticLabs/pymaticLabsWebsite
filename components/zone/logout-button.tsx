"use client"

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { localePath } from '@/lib/i18n'

// Cerrar la sesion de la zona en este navegador. Sin sesion ya (401), se da por cerrada.
export default function LogoutButton() {
  const t = useTranslations('zone.frame')
  const locale = useLocale()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  async function logout() {
    setBusy(true)
    setFailed(false)
    try {
      const res = await fetch('/api/zone/logout', { method: 'POST' })
      if (!res.ok && res.status !== 401) throw new Error(String(res.status))
      window.location.assign(localePath(locale, '/zona/entrar'))
    } catch {
      setFailed(true)
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="outline" onClick={logout} disabled={busy}>
        <LogOut className="h-4 w-4" aria-hidden="true" />
        {busy ? t('loggingOut') : t('logout')}
      </Button>
      {failed && (
        <p role="alert" className="text-sm text-danger">
          {t('logoutError')}
        </p>
      )}
    </div>
  )
}
