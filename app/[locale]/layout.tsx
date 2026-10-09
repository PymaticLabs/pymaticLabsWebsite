import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages, getTranslations, setRequestLocale } from 'next-intl/server'
import { notFound } from 'next/navigation'
import { Analytics } from '@vercel/analytics/next'
import { locales } from '@/lib/i18n'
import Navbar from '@/components/navbar'
import Footer from '@/components/footer'
import '@/app/globals.css'

const CLIENT_NAMESPACES = ['nav', 'demo', 'contact'] as const

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
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
      images: [{ url: '/og-image.png', width: 1200, height: 630 }],
    },
    twitter: {
      card: 'summary_large_image',
    },
    icons: {
      icon: '/logo.png',
      apple: '/logo.png',
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

  return (
    <html lang={locale} className={inter.variable}>
      <body className="min-h-screen flex flex-col">
        <NextIntlClientProvider messages={clientMessages}>
          <Navbar />
          <main className="flex-1">{children}</main>
          <Footer />
        </NextIntlClientProvider>
        <Analytics />
      </body>
    </html>
  )
}
