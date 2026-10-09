import fs from 'fs'
import path from 'path'
import { marked } from 'marked'

const contentDir = path.join(process.cwd(), 'content')

/**
 * Lee un texto de content/<carpeta>/<idioma>/<nombre>.md y lo devuelve en HTML.
 * Son textos nuestros, versionados en el repo; no hay entrada de usuarios.
 */
export function renderContent(folder: string, locale: string, name: string): string {
  const file = path.join(contentDir, folder, locale, `${name}.md`)
  const source = fs.readFileSync(file, 'utf-8')
  return marked.parse(source, { async: false, gfm: true })
}
