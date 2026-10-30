"use client"

import { useTranslations } from 'next-intl'
import { Moon, Sun } from 'lucide-react'
import { useTheme } from '@/components/theme-provider'

// El icono y el nombre del boton salen de la clase .dark, que el script del <head> pone antes de pintar
// (lib/theme.ts): desde el primer momento se ve el del tema de la pagina, sin la luna un instante en el
// modo oscuro hasta que carga el JS. Al pulsar, el tema contrario al que tiene la pagina.
export default function ThemeToggle() {
  const t = useTranslations('nav')
  const { setTheme } = useTheme()

  return (
    <button
      type="button"
      onClick={() => setTheme(document.documentElement.classList.contains('dark') ? 'light' : 'dark')}
      className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-line bg-surface/70 text-muted transition-colors hover:text-ink dark:bg-transparent"
    >
      <Moon className="h-5 w-5 dark:hidden" aria-hidden="true" />
      <Sun className="hidden h-5 w-5 dark:block" aria-hidden="true" />
      <span className="sr-only dark:hidden">{t('themeDark')}</span>
      <span className="sr-only hidden dark:inline">{t('themeLight')}</span>
    </button>
  )
}
