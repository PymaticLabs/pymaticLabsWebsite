import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages, getTranslations, setRequestLocale } from 'next-intl/server'
import Navbar from '@/components/navbar'
import Footer from '@/components/footer'
import { ThemeProvider } from '@/components/theme-provider'
import { zoneAvailable } from '@/lib/delivery/config'
import { noFlashScript } from '@/lib/theme'
import { profileHintScript } from '@/lib/zone-profile'
import NotFound from './[locale]/not-found'
import '@/app/globals.css'

// La 404 de lo que no pasa por un idioma (un idioma que no existe, una ruta con punto): el layout de la
// raiz no pinta <html>, asi que esta pinta el suyo, en castellano y con la barra y el pie de siempre.
const sans = Inter({
  subsets: ['latin'],
  axes: ['opsz'],
  variable: '--font-inter',
})

const LOCALE = 'es'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations({ locale: LOCALE, namespace: 'notFound' })
  return {
    title: `${t('metaTitle')} · Pymatic Labs`,
    icons: {
      icon: [
        { url: '/icon.svg', type: 'image/svg+xml' },
        { url: '/icon-48.png', sizes: '48x48', type: 'image/png' },
      ],
      apple: '/apple-icon.png',
    },
  }
}

export default async function RootNotFound() {
  setRequestLocale(LOCALE)
  const messages = await getMessages({ locale: LOCALE })
  const zone = zoneAvailable()

  return (
    <html lang={LOCALE} className={sans.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: zone ? noFlashScript + profileHintScript : noFlashScript }} />
      </head>
      <body className="min-h-screen flex flex-col">
        <ThemeProvider>
          <NextIntlClientProvider locale={LOCALE} messages={{ nav: messages.nav }}>
            <Navbar zone={zone} />
            <main className="flex-1">
              <NotFound />
            </main>
            <Footer />
          </NextIntlClientProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
