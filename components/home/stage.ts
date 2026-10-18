// Lo que comparten la capa de texto de la home (scrolly.tsx) y el cerebro (core-scene.tsx), sin que
// el servidor cargue three.js. Por escena (0 portada ... 6 tareas): el bloque de texto, su titular
// (que el hilo dibuja encima) y sus enlaces (fuera del tabulador mientras el bloque no se ve). Por
// zona (0 local ... 5 tareas, la de la escena k es la k - 1): su etiqueta alrededor del simbolo, los
// nombres de sus carpetas y documentos y su ruta (cerebro, zona y carpeta). Ademas, el indice de escenas
// (se queda en numeros mientras se lee) y el aviso de scroll. La escena los coloca y los muestra en
// cada fotograma; hasta que pinta el primero (live), el texto lo lleva scrolly. Al saltar desde el
// indice, scrolly apunta cuando (leap, en ms de performance.now): ese salto no se recorre, se funde.
export const stage = {
  live: false,
  leap: 0,
  blocks: [] as (HTMLElement | null)[],
  titles: [] as (HTMLElement | null)[],
  actions: [] as (HTMLElement | null)[],
  zoneLabels: [] as (HTMLElement | null)[],
  folders: [] as (HTMLElement | null)[][],
  files: [] as (HTMLElement | null)[][],
  crumbs: [] as (HTMLElement | null)[],
  nav: null as HTMLElement | null,
  hint: null as HTMLElement | null,
}

/**
 * Scroll entre dos paradas, en alto de pantalla (svh): da tiempo a leer quieto en cada parada y a que
 * la camara se aleje y se acerque despacio (cada golpe de rueda acerca menos de x1,12, ver ZONE_ZOOM
 * en core-scene.tsx). El indice de escenas y el reajuste al cambiar el tamano lo leen del alto de la
 * seccion (con sceneAt y sceneTop), asi que solo se cambia aqui.
 */
export const SCENE_VH = 320
/** Tras la ultima parada, la seccion sigue SCENE_TAIL escenas con todo quieto, como en las demas paradas. */
export const SCENE_TAIL = 0.15

/** Alto de la seccion del viaje en svh: las escenas, el ultimo rato quieto y la pantalla en la que va pegado. */
export const sectionVh = (count: number) => (count + SCENE_TAIL) * SCENE_VH + 100

/** Escena (0 portada ... count la ultima, decimales entre medias) segun el progreso del scroll por la seccion (0 a 1). */
export const sceneAt = (progress: number, count: number) => Math.min(count, Math.max(0, progress) * (count + SCENE_TAIL))

/** Progreso del scroll por la seccion (0 a 1) en el que esta la escena k. */
export const sceneTop = (k: number, count: number) => k / (count + SCENE_TAIL)

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
