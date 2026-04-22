import type { Metadata } from 'next'
import Hero from '@/components/sections/hero'
import Problems from '@/components/sections/problems'
import ServicesSummary from '@/components/sections/services-summary'
import CaseStudyFeatured from '@/components/sections/case-study-featured'
import About from '@/components/sections/about'
import HowWeWork from '@/components/sections/how-we-work'
import FAQ from '@/components/sections/faq'
import Contact from '@/components/sections/contact'
import { getOrganizationSchema, getWebSiteSchema } from '@/lib/schemas'

export const metadata: Metadata = {
  title: 'Pymatic Labs · Automatización con IA para pymes españolas',
  description:
    'Automatizamos facturas, reseñas de Google, contabilidad y procesos repetitivos para pymes españolas con Python, n8n e IA.',
}

export default function HomePage() {
  const orgSchema = getOrganizationSchema()
  const webSchema = getWebSiteSchema()

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(orgSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(webSchema) }}
      />
      <Hero />
      <Problems />
      <ServicesSummary />
      <CaseStudyFeatured />
      <About />
      <HowWeWork />
      <FAQ />
      <Contact />
    </>
  )
}
