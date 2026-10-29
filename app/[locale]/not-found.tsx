import type { Metadata } from 'next'
import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { getTranslations } from 'next-intl/server'
import { CerebroIcon } from '@/components/cerebro-icon'
import { Button } from '@/components/ui/button'
import { localePath } from '@/lib/i18n'

// La pagina que no existe, dentro del layout del idioma (con la barra y el pie): una frase llana y por
// donde seguir. La piden notFound() de las paginas y app/[locale]/[...rest]. Next le pone noindex.
export async function generateMetadata(props: { params?: Promise<{ locale?: string }> }): Promise<Metadata> {
  const locale = (await props.params)?.locale === 'en' ? 'en' : 'es'
  const t = await getTranslations({ locale, namespace: 'notFound' })
  return { title: t('metaTitle') }
}

export default function NotFound() {
  const t = useTranslations('notFound')
  const locale = useLocale()

  return (
    <section className="pt-32 pb-24">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <CerebroIcon className="mx-auto h-16 w-16" />
        <p className="mt-6 text-sm font-semibold uppercase tracking-wider text-brand">{t('eyebrow')}</p>
        <h1 className="mt-3 text-3xl sm:text-4xl font-bold tracking-tight text-ink">{t('title')}</h1>
        <p className="mt-4 text-lg text-body">{t('text')}</p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button size="lg" className="w-full sm:w-auto" asChild>
            <Link href={localePath(locale)}>{t('home')}</Link>
          </Button>
          <Button size="lg" variant="outline" className="w-full sm:w-auto" asChild>
            <Link href={localePath(locale, '/precios')}>{t('pricing')}</Link>
          </Button>
          <Button size="lg" variant="outline" className="w-full sm:w-auto" asChild>
            <Link href={localePath(locale, '/contacto')}>{t('contact')}</Link>
          </Button>
        </div>
      </div>
    </section>
  )
}
