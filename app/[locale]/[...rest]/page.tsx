import { notFound } from 'next/navigation'

// Cualquier ruta que no existe (/no-existe, /en/es/precios...) cae aqui, dentro del idioma: asi sale la
// 404 de la web (not-found.tsx), con la barra, el pie y el idioma de la ruta.
export default function CatchAllPage() {
  notFound()
}
