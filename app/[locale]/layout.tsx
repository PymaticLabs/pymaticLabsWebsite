import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages } from 'next-intl/server'
import { notFound } from 'next/navigation'
import { locales } from '@/lib/i18n'
import Navbar from '@/components/navbar'
import Footer from '@/components/footer'
import '@/app/globals.css'

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
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://pymaticlabs.com'

  return {
    metadataBase: new URL(baseUrl),
    title: {
      default: 'Pymatic Labs · Automatización con IA para pymes',
      template: '%s · Pymatic Labs',
    },
    description:
      locale === 'es'
        ? 'Automatizamos facturas, reseñas de Google, contabilidad y procesos repetitivos para pymes españolas con Python, n8n e IA.'
        : 'We automate invoices, Google reviews, accounting and repetitive processes for Spanish SMBs with Python, n8n and AI.',
    keywords: ['automatización', 'pymes', 'python', 'n8n', 'IA', 'facturas', 'reseñas Google'],
    authors: [{ name: 'Pymatic Labs' }],
    creator: 'Pymatic Labs',
    openGraph: {
      type: 'website',
      locale: locale === 'es' ? 'es_ES' : 'en_US',
      url: baseUrl,
      siteName: 'Pymatic Labs',
      images: [{ url: '/og-image.png', width: 1200, height: 630 }],
    },
    twitter: {
      card: 'summary_large_image',
      site: '@pymaticlabs',
    },
    alternates: {
      languages: {
        es: baseUrl,
        en: `${baseUrl}/en`,
      },
    },
    robots: {
      index: true,
      follow: true,
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

  const messages = await getMessages()

  return (
    <html lang={locale} className={inter.variable}>
      <body className="min-h-screen flex flex-col">
        <NextIntlClientProvider messages={messages}>
          <Navbar />
          <main className="flex-1">{children}</main>
          <Footer />
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
