"use client"

import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { type Theme, THEME_COOKIE } from '@/lib/theme'

type ThemeContextValue = {
  theme: Theme
  resolvedTheme: 'light' | 'dark'
  setTheme: (t: Theme) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'))
  return match ? decodeURIComponent(match[1]) : null
}

function writeCookie(name: string, value: string) {
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`
}

const systemPrefersDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches

function applyClass(resolved: 'light' | 'dark') {
  document.documentElement.classList.toggle('dark', resolved === 'dark')
}

// El tema se guarda en una cookie y se aplica antes de pintar con el script del layout, asi que
// aqui solo se sincroniza el estado y se escucha el cambio del sistema.
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('system')
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>('light')

  useEffect(() => {
    setThemeState((readCookie(THEME_COOKIE) as Theme | null) ?? 'system')
  }, [])

  useEffect(() => {
    const resolve = (): 'light' | 'dark' => (theme === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : theme)
    const next = resolve()
    setResolvedTheme(next)
    applyClass(next)

    if (theme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => {
      const r = resolve()
      setResolvedTheme(r)
      applyClass(r)
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [theme])

  const setTheme = useCallback((t: Theme) => {
    writeCookie(THEME_COOKIE, t)
    setThemeState(t)
  }, [])

  return <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>{children}</ThemeContext.Provider>
}

const defaultThemeContext: ThemeContextValue = {
  theme: 'system',
  resolvedTheme: 'light',
  setTheme: () => {},
}

export function useTheme() {
  return useContext(ThemeContext) ?? defaultThemeContext
}
