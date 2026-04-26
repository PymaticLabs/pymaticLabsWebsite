"use client"

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useTranslations, useLocale } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Menu, X } from 'lucide-react'

export default function Navbar() {
  const t = useTranslations('nav')
  const locale = useLocale()
  const [isScrolled, setIsScrolled] = useState(false)
  const [isMobileOpen, setIsMobileOpen] = useState(false)

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 10)
    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  const prefix = locale === 'en' ? '/en' : ''
  const altLocale = locale === 'en' ? 'es' : 'en'
  const altPrefix = altLocale === 'en' ? '/en' : ''

  const navLinks = [
    { href: `${prefix}/servicios`, label: t('servicios') },
    { href: `${prefix}/casos`, label: t('casos') },
    { href: `${prefix}/blog`, label: t('blog') },
    { href: `${prefix}/sobre-nosotros`, label: t('sobre') },
  ]

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        isScrolled
          ? 'bg-white/90 backdrop-blur-md shadow-sm border-b border-[#E2E8F0]'
          : 'bg-transparent'
      }`}
    >
      <nav className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Logo */}
        <Link href={prefix || '/'} className="flex items-center">
          <span className="text-xl font-bold text-[#1E3A5F]">Pymatic Labs</span>
        </Link>

        {/* Desktop Nav */}
        <div className="hidden md:flex items-center gap-6">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm text-[#0F172A] hover:text-[#1E3A5F] transition-colors"
            >
              {link.label}
            </Link>
          ))}
        </div>

        {/* Desktop Actions */}
        <div className="hidden md:flex items-center gap-3">
          <Link
            href={`${altPrefix}/`}
            className="text-sm font-medium text-[#475569] hover:text-[#1E3A5F] border border-[#E2E8F0] rounded px-2 py-1"
          >
            {t('langSwitch')}
          </Link>
          <Button variant="accent" size="sm" asChild>
            <a href="#contacto">{t('cta')}</a>
          </Button>
        </div>

        {/* Mobile Menu Button */}
        <button
          className="md:hidden p-2 text-[#0F172A]"
          onClick={() => setIsMobileOpen(!isMobileOpen)}
          aria-label="Toggle menu"
        >
          {isMobileOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </nav>

      {/* Mobile Menu */}
      {isMobileOpen && (
        <div className="md:hidden bg-white border-t border-[#E2E8F0] px-4 py-4 space-y-3">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="block text-sm text-[#0F172A] hover:text-[#1E3A5F] py-2"
              onClick={() => setIsMobileOpen(false)}
            >
              {link.label}
            </Link>
          ))}
          <div className="pt-2 flex items-center gap-3">
            <Link
              href={`${altPrefix}/`}
              className="text-sm font-medium text-[#475569] hover:text-[#1E3A5F] border border-[#E2E8F0] rounded px-2 py-1"
            >
              {t('langSwitch')}
            </Link>
            <Button variant="accent" size="sm" asChild>
              <a href="#contacto" onClick={() => setIsMobileOpen(false)}>
                {t('cta')}
              </a>
            </Button>
          </div>
        </div>
      )}
    </header>
  )
}
