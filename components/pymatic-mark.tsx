// El simbolo de Pymatic Labs: las dos piezas de la marca, la negra y la azul (#0463FE), trazadas del logo
// en su caja de 155 x 254. La negra va en currentColor: negra sobre claro y blanca sobre oscuro (con
// text-ink, o text-white en el pie).
export function PymaticMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 155 254" aria-hidden="true" className={className}>
      <path fill="currentColor" d="M0 99 76 55l38 22-76 44v111L0 254Z" />
      <path fill="#0463FE" d="M155 0 117 22v110l-76 44 38 22 76-44Z" />
    </svg>
  )
}
