// La copia duradera de las condiciones que acepto cada cliente (clausula 2 de las condiciones: las
// recibe "en un formato que puede guardar"). Es un HTML que se abre sin internet, con la version y
// su huella (SHA-256 del texto), y con quien las acepto y cuando.
//
// Cada version se guarda una vez en el almacen privado (condiciones/<version>/<idioma>.html) al
// crear el primer pago con ella: si el texto cambia entre el pago y el correo, la copia es la que
// se acepto, no la nueva.

import fs from 'node:fs'
import path from 'node:path'
import { marked } from 'marked'
import { LEGAL_VERSIONS, PENDING_NOTE } from '../legal-versions.ts'
import { escapeHtml, sha256Hex } from './util.ts'
import type { Locale, MailAttachment, Storage } from './types.ts'

const ACCEPTANCE = '<!--aceptacion-->'

export interface TermsVersion {
  version: string
  /** El idioma del texto: en ingles, mientras no haya traduccion, el castellano. */
  lang: Locale
  sha256: string
  markdown: string
}

export function currentTerms(locale: Locale, root = process.cwd()): TermsVersion {
  const file = (l: Locale) => path.join(root, 'content', 'legal', l, 'condiciones.md')
  const lang: Locale = fs.existsSync(file(locale)) ? locale : 'es'
  const markdown = fs.readFileSync(file(lang), 'utf-8').replace(PENDING_NOTE, '')
  return { version: LEGAL_VERSIONS.condiciones, lang, sha256: sha256Hex(markdown), markdown }
}

export function termsPath(version: string, locale: Locale): string {
  return `condiciones/${version}/${locale}.html`
}

const TITLES: Record<Locale, string> = { es: 'Condiciones de uso y venta', en: 'Terms of use and sale' }

export function renderTermsHtml(terms: TermsVersion, locale: Locale): string {
  const title = TITLES[locale]
  const intro =
    locale === 'en'
      ? `Version published on ${terms.version}. SHA-256 fingerprint of the text: ${terms.sha256}.${terms.lang === 'es' ? ' The Spanish version prevails and is the only one available for now.' : ''}`
      : `Versión publicada el ${terms.version}. Huella SHA-256 del texto: ${terms.sha256}.`
  return [
    '<!doctype html>',
    `<html lang="${terms.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">`,
    `<title>${title} · ${terms.version}</title>`,
    '<style>body{font:16px/1.6 system-ui,sans-serif;max-width:46rem;margin:2rem auto;padding:0 1rem;color:#1a1a1a}',
    'header{border-bottom:1px solid #ddd;margin-bottom:2rem;padding-bottom:1rem}.meta{color:#555;font-size:14px}',
    '.acceptance{background:#f4f4f4;padding:.75rem 1rem;border-radius:8px;font-size:14px}</style></head><body>',
    `<header><p><strong>PYMATICLABS, SOCIEDAD LIMITADA</strong> · info@pymaticlabs.com</p><h1>${title}</h1>`,
    `<p class="meta">${escapeHtml(intro)}</p>${ACCEPTANCE}</header>`,
    marked.parse(terms.markdown, { async: false, gfm: true }),
    '</body></html>',
  ].join('\n')
}

/** Guarda la version vigente si aun no esta, y dice cual es (va en los metadatos del pago). */
export async function ensureTermsSnapshot(storage: Storage, locale: Locale): Promise<TermsVersion> {
  const terms = currentTerms(locale)
  const target = termsPath(terms.version, locale)
  if (!(await storage.exists('customer-files', target))) {
    await storage.put('customer-files', target, Buffer.from(renderTermsHtml(terms, locale), 'utf-8'), 'text/html; charset=utf-8')
  }
  return terms
}

/**
 * El adjunto del correo de bienvenida: la version aceptada, con quien y cuando la acepto. Si no
 * esta guardada (el pago se creo fuera de la web), la vigente si es la misma version.
 */
export async function termsAttachment(
  storage: Storage,
  input: { version: string | null; locale: Locale; company: string; taxId: string; acceptedAt: string; paymentRef: string }
): Promise<{ attachment: MailAttachment; version: string } | null> {
  const current = currentTerms(input.locale)
  const version = input.version ?? current.version
  let html = (await storage.get('customer-files', termsPath(version, input.locale)))?.toString('utf-8') ?? null
  if (!html && version === current.version) {
    html = renderTermsHtml(current, input.locale)
    await storage.put('customer-files', termsPath(version, input.locale), Buffer.from(html, 'utf-8'), 'text/html; charset=utf-8')
  }
  if (!html) return null
  const when = new Intl.DateTimeFormat(input.locale === 'en' ? 'en-GB' : 'es-ES', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'Europe/Madrid',
  }).format(new Date(input.acceptedAt))
  const acceptance =
    input.locale === 'en'
      ? `Accepted by ${input.company} (${input.taxId}) on ${when} (Spanish peninsular time), in the purchase ${input.paymentRef}.`
      : `Aceptadas por ${input.company} (${input.taxId}) el ${when} (hora peninsular), en la compra ${input.paymentRef}.`
  const personal = html.replace(ACCEPTANCE, `<p class="acceptance">${escapeHtml(acceptance)}</p>`)
  return {
    version,
    attachment: {
      name: `${input.locale === 'en' ? 'terms' : 'condiciones'}-${version}.html`,
      content: Buffer.from(personal, 'utf-8'),
      contentType: 'text/html',
    },
  }
}
