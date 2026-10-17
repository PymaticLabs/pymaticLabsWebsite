// Lo que comparten la capa de texto de la home (scrolly.tsx) y el cerebro (core-scene.tsx), sin que
// el servidor cargue three.js. Por escena (0 portada ... 6 tareas): el bloque de texto, su titular
// (que el hilo escribe encima) y sus enlaces (fuera del tabulador mientras el bloque no se ve). Por
// zona (0 local ... 5 tareas, la de la escena k es la k - 1): su etiqueta alrededor del simbolo, los
// nombres de sus carpetas y documentos y su ruta en los instrumentos. Ademas, el indice de escenas
// (se queda en numeros mientras se lee) y el aviso de scroll. La escena los coloca, los muestra y
// escribe el aumento en cada fotograma; hasta que pinta el primero (live), el texto lo lleva scrolly.
export const stage = {
  live: false,
  blocks: [] as (HTMLElement | null)[],
  titles: [] as (HTMLElement | null)[],
  actions: [] as (HTMLElement | null)[],
  zoneLabels: [] as (HTMLElement | null)[],
  folders: [] as (HTMLElement | null)[][],
  files: [] as (HTMLElement | null)[][],
  crumbs: [] as (HTMLElement | null)[][],
  nav: null as HTMLElement | null,
  hint: null as HTMLElement | null,
  hud: {
    root: null as HTMLElement | null,
    zoom: null as HTMLElement | null,
    bar: null as HTMLElement | null,
    levels: [] as (HTMLElement | null)[],
  },
}

/**
 * Muestra u oculta el bloque de texto de una escena. Oculto sigue en el arbol de accesibilidad (los
 * titulares se leen con lector de pantalla), pero no recibe clics y sus enlaces salen del tabulador.
 */
export function showBlock(k: number, shown: boolean) {
  const block = stage.blocks[k]
  if (block) {
    block.style.opacity = shown ? '1' : '0'
    block.style.pointerEvents = shown ? '' : 'none'
  }
  const actions = stage.actions[k]
  if (actions) actions.inert = !shown
}
