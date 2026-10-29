// llms.txt (https://llmstxt.org): lo que leen los asistentes de IA cuando alguien les pregunta por Pymatic
// Labs (robots.ts les deja pasar). Se genera con la oferta (lib/offer.ts) y los textos de la web
// (messages/*.json), para que no se desfase: si cambia un precio, lo que trae una modalidad, los mercados
// o a quien se vende, cambia aqui solo. Escrito a mano solo va lo que es el producto y las reglas fijas
// de la oferta (el Hazlo tu sin sesiones; el Acompanado no monta procedimientos ni carga documentos).
// Sin plazas de lanzamiento (launchOpen false, como /precios), solo el precio de lista.
// Sin imports de Next ni alias: lo prueba node --test (lib/llms.test.mts).

import {
  ANNUAL_PAID_MONTHS,
  CUSTOM_FROM_PRICE,
  GUARANTEE_DAYS,
  LAUNCH_CUSTOMERS,
  SETUP_SESSIONS,
  TEAM_MAX_PEOPLE,
  formatPrice,
  modalities,
  plans,
} from '../../lib/offer.ts'
import { BOOKING_URL } from '../[locale]/contacto/booking.ts'

type Messages = Record<string, unknown>

/** Un texto de la web por su ruta (pricing.b2b); si falta, error: mejor no publicar que publicar mal. */
function text(messages: Messages, key: string): string {
  const value = key.split('.').reduce<unknown>((at, part) => (at && typeof at === 'object' ? (at as Record<string, unknown>)[part] : undefined), messages)
  if (typeof value !== 'string') throw new Error(`llms.txt: falta el texto ${key}`)
  return value
}

function list(messages: Messages, key: string): string[] {
  const value = key.split('.').reduce<unknown>((at, part) => (at && typeof at === 'object' ? (at as Record<string, unknown>)[part] : undefined), messages)
  if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) throw new Error(`llms.txt: falta la lista ${key}`)
  return value as string[]
}

/** El lema de la tarjeta, en medio de una frase: «You set it up.» pasa a «you set it up». */
const lowerFirst = (value: string) => value.charAt(0).toLowerCase() + value.slice(1)

/** «1 month», «3 months». */
const months = (n: number) => `${n} month${n === 1 ? '' : 's'}`

export function buildLlmsTxt({ es, en, baseUrl, launchOpen = true }: { es: Messages; en: Messages; baseUrl: string; launchOpen?: boolean }): string {
  const eur = (amount: number) => formatPrice(amount, 'en')
  const planName = (id: string) => text(en, `offer.plans.${id}`)

  const modalityLines = modalities.map((m) => {
    const name = `${text(en, `offer.modalities.${m.id}.name`)} (${text(es, `offer.modalities.${m.id}.name`)})`
    const facts = [
      launchOpen ? `${eur(m.listPrice)} list, ${eur(m.launchPrice)} launch price` : eur(m.listPrice),
      m.team ? `up to ${TEAM_MAX_PEOPLE} people, with locked areas` : '1 person',
      lowerFirst(text(en, `offer.modalities.${m.id}.tagline`).replace(/\.$/, '')),
      m.guided
        ? `set up by Pymatic Labs in ${SETUP_SESSIONS} one-hour video calls, with automation ideas for the company; it does not set up the customer's own procedures or load the customer's documents`
        : 'no setup sessions: the customer sets it up with the extension and the guides',
      m.includedMonths ? `${months(m.includedMonths.months)} of the ${planName(m.includedMonths.plan)} monthly plan included` : 'no monthly plan included',
    ]
    return `- ${name}: ${facts.join('; ')}.`
  })

  const planLine = plans.map((p) => `${planName(p.id)} ${eur(p.monthly)}`).join(', ')
  // Al ano, lo que cobra el pago (plan.yearly), no una cuenta hecha aqui.
  const annualLine = plans.map((p) => eur(p.yearly)).join(', ')

  return [
    '# Pymatic Labs · Cerebro Digital (Digital Brain)',
    '',
    "> Pymatic Labs (PYMATICLABS, S.L., Castellón de la Plana, Spain) makes the Cerebro Digital / Digital Brain: a company's knowledge, digitized and indexed so any AI can look it up, and an AI (Claude) that can also run the company's processes on request. It lives on the customer's own computers.",
    '',
    '## What it is',
    "- The company's memory: how things are done, criteria, reference data and where each document is. It answers citing the source document.",
    '- It runs written procedures step by step and learns new ones when the user approves them.',
    "- It lives on the customer's computers (Mac and Windows), not in the cloud. Pymatic Labs never receives the brain or the passwords.",
    '- It works with Claude (Claude Desktop and Cowork, also from a phone). It is set up through a Claude Desktop extension.',
    `- Teams: up to ${TEAM_MAX_PEOPLE} people on the same brain, with locked areas.`,
    '- It never opens health files, never copies passwords and asks for approval before changing anything.',
    '',
    '## Pricing (EUR, excluding VAT, one-off payment, perpetual license per company)',
    ...modalityLines,
    launchOpen ? `- Launch prices apply to the first ${LAUNCH_CUSTOMERS} customers; after that, the list price.` : `- Launch prices are over. ${text(en, 'pricing.launchOver')}`,
    `- In all four: ${list(en, 'pricing.included').join('; ')}.`,
    `- Guarantee: Pymatic Labs refunds the one-off payment, asked for in writing within ${GUARANTEE_DAYS} days of purchase, only if the brain cannot be set up because of a product fault. It is not a satisfaction guarantee.`,
    `- Setup sessions: ${list(en, 'pricing.sessions.items')[0]}`,
    `- Optional monthly plans, per month: ${planLine}. Paid yearly, the price of ${ANNUAL_PAID_MONTHS} months: ${annualLine}. ${text(en, 'pricing.monthly.subtitle')} ${text(en, 'pricing.monthly.securityNote')}`,
    `- ${text(en, 'pricing.apart.custom.name')}: from ${eur(CUSTOM_FROM_PRICE)}. ${text(en, 'pricing.apart.custom.text')} ${text(en, 'pricing.apart.moreThan10')}`,
    // Como en /precios: a quien se vende y, debajo, el IVA de cada caso.
    `- ${text(en, 'pricing.b2b')}`,
    `- ${text(en, 'pricing.markets')}`,
    '',
    '## Pages',
    `- Home: ${baseUrl}/ (English: ${baseUrl}/en)`,
    `- Features: ${baseUrl}/funciones`,
    `- Pricing: ${baseUrl}/precios`,
    `- Security and privacy: ${baseUrl}/seguridad`,
    // Las condiciones ya estan tambien en ingles (prevalece la castellana).
    `- Terms of use and sale: ${baseUrl}/condiciones (English: ${baseUrl}/en/condiciones)`,
    `- Contact: ${baseUrl}/contacto`,
    '',
    '## Contact',
    '- Email: info@pymaticlabs.com',
    `- Book a video call: ${BOOKING_URL}`,
    '',
  ].join('\n')
}
