"use client"

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Moon, Sun } from 'lucide-react'
import { useTheme } from '@/components/theme-provider'

export default function ThemeToggle() {
  const t = useTranslations('nav')
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  const isDark = mounted && resolvedTheme === 'dark'

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      aria-label={isDark ? t('themeLight') : t('themeDark')}
      className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-line text-muted transition-colors hover:text-ink"
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  )
}
