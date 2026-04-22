import Link from 'next/link'
import { useTranslations, useLocale } from 'next-intl'
import { ExternalLink, Mail, MapPin } from 'lucide-react'

export default function Footer() {
  const t = useTranslations('footer')
  const locale = useLocale()
  const prefix = locale === 'en' ? '/en' : ''

  return (
    <footer className="bg-[#0F172A] text-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          {/* Col 1: Logo + tagline */}
          <div className="space-y-3">
            <Link href={prefix || '/'} className="flex items-center">
              <span className="text-xl font-bold text-white">Pymatic Labs</span>
            </Link>
            <p className="text-sm text-gray-400">{t('tagline')}</p>
            <div className="flex items-center gap-1 text-sm text-gray-400">
              <MapPin className="h-3 w-3" />
              <span>Castellón, España</span>
            </div>
          </div>

          {/* Col 2: Quick links */}
          <div>
            <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-4">
              {t('quickLinks')}
            </h3>
            <ul className="space-y-2">
              {[
                { href: `${prefix}/servicios`, label: t('links.servicios') },
                { href: `${prefix}/casos`, label: t('links.casos') },
                { href: `${prefix}/blog`, label: t('links.blog') },
                { href: `${prefix}/sobre-nosotros`, label: t('links.sobre') },
                { href: `${prefix}/contacto`, label: t('links.contacto') },
              ].map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-sm text-gray-400 hover:text-white transition-colors"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Col 3: Legal */}
          <div>
            <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-4">
              {t('legal')}
            </h3>
            <ul className="space-y-2">
              {[
                { href: `${prefix}/aviso-legal`, label: t('legalLinks.aviso') },
                { href: `${prefix}/politica-privacidad`, label: t('legalLinks.privacidad') },
                { href: `${prefix}/politica-cookies`, label: t('legalLinks.cookies') },
              ].map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-sm text-gray-400 hover:text-white transition-colors"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Col 4: Social */}
          <div>
            <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-4">
              {t('connect')}
            </h3>
            <div className="space-y-3">
              <a
                href="https://linkedin.com/company/pymaticlabs"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors"
              >
                <ExternalLink className="h-4 w-4" />
                LinkedIn
              </a>
              <a
                href="https://github.com/pymaticlabs"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors"
              >
                <ExternalLink className="h-4 w-4" />
                GitHub
              </a>
              <a
                href="mailto:hola@pymaticlabs.com"
                className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors"
              >
                <Mail className="h-4 w-4" />
                hola@pymaticlabs.com
              </a>
            </div>
          </div>
        </div>

        <div className="mt-8 pt-8 border-t border-gray-800">
          <p className="text-sm text-gray-500 text-center">{t('copyright')}</p>
        </div>
      </div>
    </footer>
  )
}
