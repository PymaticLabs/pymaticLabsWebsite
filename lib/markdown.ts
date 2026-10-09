import fs from 'fs'
import path from 'path'
import { marked } from 'marked'
import { defaultLocale } from '@/lib/i18n'

const contentDir = path.join(process.cwd(), 'content')

/**
 * Lee un texto de content/<carpeta>/<idioma>/<nombre>.md y lo devuelve en HTML.
 * Si no existe en ese idioma, devuelve el castellano y lo indica con `fallback`.
 * Son textos nuestros, versionados en el repo; no hay entrada de usuarios.
 */
export function renderContent(folder: string, locale: string, name: string): { html: string; fallback: boolean } {
  const file = (l: string) => path.join(contentDir, folder, l, `${name}.md`)
  const fallback = !fs.existsSync(file(locale))
  const source = fs.readFileSync(file(fallback ? defaultLocale : locale), 'utf-8')
  return { html: marked.parse(source, { async: false, gfm: true }), fallback }
}
