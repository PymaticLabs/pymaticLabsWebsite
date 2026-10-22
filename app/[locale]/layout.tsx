import type { Metadata } from 'next'
import { Atkinson_Hyperlegible_Mono, Inter } from 'next/font/google'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages, getTranslations, setRequestLocale } from 'next-intl/server'
import { notFound } from 'next/navigation'
import { Analytics } from '@vercel/analytics/next'
import { locales } from '@/lib/i18n'
import { ogImage } from '@/lib/metadata'
import Navbar from '@/components/navbar'
import Footer from '@/components/footer'
import { zoneAvailable } from '@/lib/delivery/config'
import { ThemeProvider } from '@/components/theme-provider'
import { noFlashScript } from '@/lib/theme'
import { profileHintScript } from '@/lib/zone-profile'
import '@/app/globals.css'

const CLIENT_NAMESPACES = ['nav', 'contact'] as const

/** Marca en <html> que hay JS: sin ella (o con "reducir movimiento") nada de la home espera a aparecer. */
const JS_MARK = "document.documentElement.classList.add('js');"

// Inter: limpia y moderna (la mas cercana a la de Apple) y hecha para leerse bien en pantalla. Con su
// tamano optico, los titulares grandes salen con el corte de titular y el texto, con el de lectura.
const sans = Inter({
  subsets: ['latin', 'latin-ext'],
  axes: ['opsz'],
  variable: '--font-inter',
})

// Atkinson de ancho fijo, para codigos y huellas de la zona de socio: ahi si importa no confundir O y 0.
const mono = Atkinson_Hyperlegible_Mono({
  subsets: ['latin'],
  variable: '--font-atkinson-mono',
})

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'meta' })
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://pymaticlabs.com'

  return {
    metadataBase: new URL(baseUrl),
    title: {
      default: t('siteTitle'),
      template: '%s · Pymatic Labs',
    },
    description: t('homeDescription'),
    authors: [{ name: 'Pymatic Labs' }],
    creator: 'Pymatic Labs',
    openGraph: {
      type: 'website',
      locale: locale === 'es' ? 'es_ES' : 'en_US',
      siteName: 'Pymatic Labs',
      images: [{ url: ogImage(locale), width: 1200, height: 630 }],
    },
    twitter: {
      card: 'summary_large_image',
    },
    // El sello del Cerebro Digital (ver components/cerebro-icon.tsx), con una copia en PNG para quien no lee SVG.
    icons: {
      icon: [
        { url: '/icon.svg', type: 'image/svg+xml' },
        { url: '/icon-48.png', sizes: '48x48', type: 'image/png' },
      ],
      apple: '/apple-icon.png',
    },
  }
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params

  if (!locales.includes(locale as 'es' | 'en')) {
    notFound()
  }

  setRequestLocale(locale)
  const messages = await getMessages()
  // Al navegador solo van los textos de los componentes de cliente.
  const clientMessages = Object.fromEntries(CLIENT_NAMESPACES.map((ns) => [ns, messages[ns]]))
  const zone = zoneAvailable()

  return (
    // El tema se lee en el navegador (cookie o sistema) para que las paginas sigan siendo estaticas.
    <html lang={locale} className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        {/* El tema, la marca de que hay JS (las apariciones de la home, ver globals.css) y, con la zona
            montada, la pista de quien ya entro: todo antes de pintar, sin saltos. */}
        <script dangerouslySetInnerHTML={{ __html: (zone ? noFlashScript + profileHintScript : noFlashScript) + JS_MARK }} />
      </head>
      <body className="min-h-screen flex flex-col">
        <ThemeProvider>
          <NextIntlClientProvider messages={clientMessages}>
            {/* Entrar (o el perfil), solo con la zona de socio montada: como el enlace del pie. */}
            <Navbar zone={zone} />
            <main className="flex-1">{children}</main>
            <Footer />
          </NextIntlClientProvider>
        </ThemeProvider>
        <Analytics />
      </body>
    </html>
  )
}
