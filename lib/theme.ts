export type Theme = 'light' | 'dark' | 'system'
export const THEME_COOKIE = 'pymatic_theme'
/** Tema sin cookie (antes de pulsar el boton): el del sistema. */
export const DEFAULT_THEME: Theme = 'system'

/** Script que se ejecuta antes de pintar: pone la clase .dark sin parpadeo. */
export const noFlashScript = `(function(){try{var m=document.cookie.match(/(?:^|; )${THEME_COOKIE}=([^;]*)/);var t=m?decodeURIComponent(m[1]):'${DEFAULT_THEME}';var d=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);}catch(e){}})();`
