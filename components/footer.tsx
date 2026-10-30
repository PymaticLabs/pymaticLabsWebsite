import Link from 'next/link'
import { useTranslations, useLocale } from 'next-intl'
import { Mail, MapPin } from 'lucide-react'
import { PymaticMark } from '@/components/pymatic-mark'
import { localePath } from '@/lib/i18n'
import { zoneAvailable } from '@/lib/delivery/config'

export default function Footer() {
  const t = useTranslations('footer')
  const locale = useLocale()

  const productLinks = [
    { href: localePath(locale, '/funciones'), label: t('links.comoFunciona') },
    { href: localePath(locale, '/precios'), label: t('links.precios') },
    { href: localePath(locale, '/seguridad'), label: t('links.seguridad') },
    { href: localePath(locale, '/contacto'), label: t('links.contacto') },
    // La zona de socio, solo cuando esta montada (ver zoneAvailable).
    ...(zoneAvailable() ? [{ href: localePath(locale, '/zona'), label: t('links.zona') }] : []),
  ]

  const legalLinks = [
    { href: localePath(locale, '/aviso-legal'), label: t('legalLinks.aviso') },
    { href: localePath(locale, '/politica-privacidad'), label: t('legalLinks.privacidad') },
    { href: localePath(locale, '/politica-cookies'), label: t('legalLinks.cookies') },
    { href: localePath(locale, '/condiciones'), label: t('legalLinks.condiciones') },
    { href: localePath(locale, '/privacidad-producto'), label: t('legalLinks.privacidadProducto') },
  ]

  return (
    <footer className="bg-inverse text-white">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-14">
        {/* En el movil, Producto y Legal lado a lado (la marca y el contacto, a todo lo ancho): el pie no se
            alarga el doble. */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-10 md:grid-cols-4 md:gap-10">
          <div className="col-span-2 space-y-3 md:col-span-1">
            <Link href={localePath(locale)} className="inline-flex min-h-11 items-center gap-2.5">
              <PymaticMark className="h-8 w-auto text-white" />
              <span className="text-lg font-bold">Pymatic Labs</span>
            </Link>
            <p className="text-sm text-white/60">{t('tagline')}</p>
          </div>

          <FooterColumn title={t('product')} links={productLinks} />
          <FooterColumn title={t('legal')} links={legalLinks} />

          <div className="col-span-2 md:col-span-1">
            <h2 className="text-sm font-semibold text-white/80 uppercase tracking-wider mb-2">
              {t('contact')}
            </h2>
            <div className="text-sm text-white/60">
              <a
                href="mailto:info@pymaticlabs.com"
                className="flex min-h-11 items-center gap-2 hover:text-white transition-colors"
              >
                <Mail className="h-4 w-4" aria-hidden="true" />
                info@pymaticlabs.com
              </a>
              <p className="flex min-h-11 items-center gap-2">
                <MapPin className="h-4 w-4" aria-hidden="true" />
                Castellón de la Plana
              </p>
            </div>
          </div>
        </div>

        <div className="mt-10 sm:mt-12 pt-8 border-t border-white/15 flex flex-col sm:flex-row gap-2 justify-between text-sm text-white/50">
          <p>
            © {new Date().getFullYear()} {t('copyright')}
          </p>
          <p>{t('b2b')}</p>
        </div>
      </div>
    </footer>
  )
}

// Los titulos del pie son h2: no cuelgan de la ultima seccion de la pagina, y tras un h1 solo (la zona,
// gracias) no se salta ningun nivel.
function FooterColumn({ title, links }: { title: string; links: { href: string; label: string }[] }) {
  return (
    <div>
      <h2 className="text-sm font-semibold text-white/80 uppercase tracking-wider mb-2">{title}</h2>
      <ul>
        {links.map((link) => (
          <li key={link.href}>
            <Link href={link.href} className="inline-flex min-h-11 items-center py-1.5 text-sm leading-snug text-white/60 hover:text-white transition-colors">
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
