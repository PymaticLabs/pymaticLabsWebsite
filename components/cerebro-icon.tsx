import { cn } from '@/lib/utils'

// El sello del Cerebro Digital: el mismo hilo del fondo de la web (una curva de Hilbert, aqui de orden 3,
// 8 x 8 celdas) que, redondeado en un ovalo algo mas estrecho delante y con la cisura abierta en medio,
// dibuja un cerebro visto desde arriba: dos hemisferios y un unico puente entre ellos (la curva solo cruza
// el centro una vez). Se genero una vez y va en un cuadro de 32 x 32; se lee como cerebro desde 16 px. Los
// iconos de public (icon.svg, icon-48.png, apple-icon.png) y la imagen para compartir llevan el mismo trazo.
export const CEREBRO_PATH =
  'M8.94 24.06L8.27 21.82L10.16 22.52L10.63 25.04L12.35 25.63L14.08 25.91L13.98 23.14L12.07 22.94L11.92 20.24L13.93 20.36L13.92 17.59L11.87 17.55L9.83 17.46L9.91 19.99L7.91 19.57L7.79 17.32L7.87 15.08L9.9 14.94L10.11 12.41L8.16 12.83L8.66 10.58L9.43 8.34L11.02 7.36L10.47 9.88L12.27 9.46L12.6 6.77L14.16 6.49L14.05 9.26L13.98 12.04L12.05 12.16L11.92 14.85L13.94 14.81L18.06 14.81L20.08 14.85L19.95 12.16L18.02 12.04L17.95 9.26L17.84 6.49L19.4 6.77L19.73 9.46L21.53 9.88L20.98 7.36L22.57 8.34L23.34 10.58L23.84 12.83L21.89 12.41L22.1 14.94L24.13 15.08L24.21 17.32L24.09 19.57L22.09 19.99L22.17 17.46L20.13 17.55L18.08 17.59L18.07 20.36L20.08 20.24L19.93 22.94L18.02 23.14L17.92 25.91L19.65 25.63L21.37 25.04L21.84 22.52L23.73 21.82L23.06 24.06'

/** Solo el hilo, del color del texto (currentColor), recortado al cerebro: para ir junto a un texto. */
export function CerebroMark({ className }: { className?: string }) {
  return (
    <svg viewBox="6.4 5.1 19.2 22.2" fill="none" aria-hidden="true" className={className}>
      <path d={CEREBRO_PATH} stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** El sello entero: el hilo en blanco sobre un cuadro azul de esquinas redondas, como el icono de una app. */
export function CerebroIcon({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('inline-flex shrink-0 items-center justify-center rounded-[25%] bg-gradient-to-br from-[#3D86FF] to-brand-dark text-white', className)}
    >
      <svg viewBox="0 0 32 32" fill="none" className="h-full w-full">
        <path d={CEREBRO_PATH} stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  )
}
