import Link from 'next/link'
import { useTranslations, useLocale } from 'next-intl'
import { Mail, MapPin } from 'lucide-react'
import { localePath } from '@/lib/i18n'

export default function Footer() {
  const t = useTranslations('footer')
  const locale = useLocale()

  const productLinks = [
    { href: localePath(locale, '/como-funciona'), label: t('links.comoFunciona') },
    { href: localePath(locale, '/precios'), label: t('links.precios') },
    { href: localePath(locale, '/seguridad'), label: t('links.seguridad') },
    { href: localePath(locale, '/contacto'), label: t('links.contacto') },
  ]

  const legalLinks = [
    { href: localePath(locale, '/aviso-legal'), label: t('legalLinks.aviso') },
    { href: localePath(locale, '/politica-privacidad'), label: t('legalLinks.privacidad') },
    { href: localePath(locale, '/politica-cookies'), label: t('legalLinks.cookies') },
    { href: localePath(locale, '/condiciones'), label: t('legalLinks.condiciones') },
    { href: localePath(locale, '/privacidad-producto'), label: t('legalLinks.privacidadProducto') },
  ]

  return (
    <footer className="bg-ink text-white">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-10">
          <div className="space-y-3">
            <Link href={localePath(locale)} className="flex items-center gap-2">
              <span className="text-lg font-bold">Pymatic Labs</span>
            </Link>
            <p className="text-sm text-white/60">{t('tagline')}</p>
          </div>

          <FooterColumn title={t('product')} links={productLinks} />
          <FooterColumn title={t('legal')} links={legalLinks} />

          <div>
            <h3 className="text-sm font-semibold text-white/80 uppercase tracking-wider mb-4">
              {t('contact')}
            </h3>
            <div className="space-y-3 text-sm text-white/60">
              <a
                href="mailto:info@pymaticlabs.com"
                className="flex items-center gap-2 hover:text-white transition-colors"
              >
                <Mail className="h-4 w-4" aria-hidden="true" />
                info@pymaticlabs.com
              </a>
              <p className="flex items-center gap-2">
                <MapPin className="h-4 w-4" aria-hidden="true" />
                Castellón de la Plana
              </p>
            </div>
          </div>
        </div>

        <div className="mt-12 pt-8 border-t border-white/15 flex flex-col sm:flex-row gap-2 justify-between text-sm text-white/50">
          <p>
            © {new Date().getFullYear()} {t('copyright')}
          </p>
          <p>{t('b2b')}</p>
        </div>
      </div>
    </footer>
  )
}

function FooterColumn({ title, links }: { title: string; links: { href: string; label: string }[] }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-white/80 uppercase tracking-wider mb-4">{title}</h3>
      <ul className="space-y-2">
        {links.map((link) => (
          <li key={link.href}>
            <Link href={link.href} className="text-sm text-white/60 hover:text-white transition-colors">
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
