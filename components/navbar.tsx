"use client"

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslations, useLocale } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Menu, X } from 'lucide-react'
import { localePath } from '@/lib/i18n'
import { cn } from '@/lib/utils'

export default function Navbar() {
  const t = useTranslations('nav')
  const locale = useLocale()
  const pathname = usePathname()
  const [isScrolled, setIsScrolled] = useState(false)
  const [isMobileOpen, setIsMobileOpen] = useState(false)

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 10)
    handleScroll()
    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  // La misma pagina en el otro idioma: las rutas no cambian, solo el prefijo /en.
  const barePath = pathname.replace(/^\/en(?=\/|$)/, '') || ''
  const altLocale = locale === 'en' ? 'es' : 'en'
  const altHref = localePath(altLocale, barePath === '/' ? '' : barePath)

  const navLinks = [
    { href: localePath(locale, '/como-funciona'), label: t('comoFunciona') },
    { href: localePath(locale, '/precios'), label: t('precios') },
    { href: localePath(locale, '/seguridad'), label: t('seguridad') },
    { href: localePath(locale, '/contacto'), label: t('contacto') },
  ]

  const isActive = (href: string) => pathname === href

  return (
    <header
      className={cn(
        'fixed top-0 left-0 right-0 z-50 transition-colors duration-300',
        isScrolled || isMobileOpen ? 'bg-white/90 backdrop-blur-md border-b border-line' : 'bg-transparent'
      )}
    >
      <nav className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <Link href={localePath(locale)} className="flex items-center gap-2" aria-label={t('home')}>
          <span className="text-lg font-bold text-ink">Pymatic Labs</span>
        </Link>

        <div className="hidden md:flex items-center gap-7">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={isActive(link.href) ? 'page' : undefined}
              className={cn(
                'text-sm transition-colors hover:text-brand',
                isActive(link.href) ? 'text-brand font-medium' : 'text-ink'
              )}
            >
              {link.label}
            </Link>
          ))}
        </div>

        <div className="hidden md:flex items-center gap-3">
          <Link
            href={altHref}
            hrefLang={altLocale}
            aria-label={t('langLabel')}
            className="text-sm font-medium text-muted hover:text-ink border border-line rounded-full px-3 py-1"
          >
            {t('langSwitch')}
          </Link>
          <Button size="sm" asChild>
            <Link href={localePath(locale, '/precios')}>{t('cta')}</Link>
          </Button>
        </div>

        <button
          className="md:hidden p-2 text-ink"
          onClick={() => setIsMobileOpen(!isMobileOpen)}
          aria-label={isMobileOpen ? t('closeMenu') : t('openMenu')}
          aria-expanded={isMobileOpen}
        >
          {isMobileOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </nav>

      {isMobileOpen && (
        <div className="md:hidden bg-white border-t border-line px-4 py-4 space-y-1">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="block text-base text-ink hover:text-brand py-2"
              onClick={() => setIsMobileOpen(false)}
            >
              {link.label}
            </Link>
          ))}
          <div className="pt-3 flex items-center gap-3">
            <Link
              href={altHref}
              hrefLang={altLocale}
              aria-label={t('langLabel')}
              className="text-sm font-medium text-muted border border-line rounded-full px-3 py-1"
            >
              {t('langSwitch')}
            </Link>
            <Button size="sm" asChild>
              <Link href={localePath(locale, '/precios')} onClick={() => setIsMobileOpen(false)}>
                {t('cta')}
              </Link>
            </Button>
          </div>
        </div>
      )}
    </header>
  )
}
