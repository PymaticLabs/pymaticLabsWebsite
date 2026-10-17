export type Theme = 'light' | 'dark' | 'system'
export const THEME_COOKIE = 'pymatic_theme'

/** Script que se ejecuta antes de pintar: pone la clase .dark sin parpadeo. */
export const noFlashScript = `(function(){try{var m=document.cookie.match(/(?:^|; )${THEME_COOKIE}=([^;]*)/);var t=m?decodeURIComponent(m[1]):'system';var d=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);}catch(e){}})();`
