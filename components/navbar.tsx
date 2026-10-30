"use client"

import { useState, useEffect, useCallback, useId, useRef } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslations, useLocale } from 'next-intl'
import { Button } from '@/components/ui/button'
import ThemeToggle from '@/components/theme-toggle'
import { PymaticMark } from '@/components/pymatic-mark'
import { ChevronDown, Download, KeyRound, LayoutGrid, LogOut, Menu, Receipt, UserRound, X } from 'lucide-react'
import { localePath } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { profileInitials, profileShortcuts, setProfileHint, type ZoneProfile, type ZoneProfileResponse } from '@/lib/zone-profile'

/** Las paginas de la zona de socio (en la ruta sin idioma): se pintan en el servidor con la sesion. */
const ZONE_PAGE = /^\/zona(\/|$)/

/**
 * La ruta sin el idioma ('/', '/precios'). En las paginas estaticas usePathname da la ruta interna de
 * next-intl (/es/precios, tambien en castellano); en las dinamicas, la de fuera (/precios o /en/precios).
 * Se quitan los dos prefijos: asi el servidor y el navegador dan lo mismo.
 */
function useBarePath() {
  return usePathname().replace(/^\/(es|en)(?=\/|$)/, '') || '/'
}

/** hidden: la zona aun no esta montada; guest: sin sesion (o aun no se sabe); si no, quien entro. */
type Account = 'hidden' | 'guest' | ZoneProfile

// zone: si la zona de socio esta montada (zoneAvailable, en el servidor), como en el pie.
export default function Navbar({ zone }: { zone: boolean }) {
  const t = useTranslations('nav')
  const locale = useLocale()
  const barePath = useBarePath()
  const [isScrolled, setIsScrolled] = useState(false)
  const [isHidden, setIsHidden] = useState(false)
  const [isMobileOpen, setIsMobileOpen] = useState(false)
  const [account, setAccount] = useState<Account>(zone ? 'guest' : 'hidden')
  const [accountOpen, setAccountOpen] = useState(false)
  const loginRef = useRef<HTMLAnchorElement>(null)
  const focusLogin = useRef(false)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const mobileMenuId = useId()

  // Con el menu del movil abierto (ocupa la pantalla): Escape lo cierra y devuelve el foco al boton que lo
  // abrio, y la pagina de detras ni se desplaza ni se alcanza con el teclado (inert). Si la pantalla se
  // ensancha hasta la barra completa (el movil en horizontal), se cierra.
  useEffect(() => {
    if (!isMobileOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setIsMobileOpen(false)
      menuButtonRef.current?.focus()
    }
    const wide = window.matchMedia('(min-width: 768px)')
    const onWide = () => {
      if (wide.matches) setIsMobileOpen(false)
    }
    const root = document.documentElement
    const behind = Array.from(document.querySelectorAll<HTMLElement>('body > main, body > footer'))
    document.addEventListener('keydown', onKey)
    wide.addEventListener('change', onWide)
    root.style.overflow = 'hidden'
    behind.forEach((el) => el.setAttribute('inert', ''))
    return () => {
      document.removeEventListener('keydown', onKey)
      wide.removeEventListener('change', onWide)
      root.style.overflow = ''
      behind.forEach((el) => el.removeAttribute('inert'))
    }
  }, [isMobileOpen])

  // La barra se vuelve opaca al bajar. Con poca altura (el movil en horizontal), ademas se esconde al bajar
  // y vuelve al subir: deja sitio a lo que se lee.
  useEffect(() => {
    const low = window.matchMedia('(max-height: 500px)')
    let lastY = window.scrollY
    const handleScroll = () => {
      const y = window.scrollY
      setIsScrolled(y > 10)
      if (Math.abs(y - lastY) < 8) return
      setIsHidden(low.matches && y > lastY && y > 64)
      lastY = y
    }
    const onLow = () => setIsHidden(false)
    handleScroll()
    window.addEventListener('scroll', handleScroll, { passive: true })
    low.addEventListener('change', onLow)
    return () => {
      window.removeEventListener('scroll', handleScroll)
      low.removeEventListener('change', onLow)
    }
  }, [])

  // Las paginas son estaticas: la sesion de la zona se pregunta desde el navegador. Mientras no se
  // sabe, Entrar (o, si este navegador ya entro antes, un circulo neutro: la pista de zone-profile);
  // si falla, Entrar.
  useEffect(() => {
    if (!zone) return
    let alive = true
    const load = () =>
      fetch('/api/zone/me?perfil=1', { cache: 'no-store' })
        .then((res) => (res.ok ? (res.json() as Promise<ZoneProfileResponse>) : null))
        .then((data) => {
          if (!alive) return
          const user = data?.available ? data.user : null
          if (data) setAccount(data.available ? (user ?? 'guest') : 'hidden')
          // Con sesion, la pista para la proxima pagina; sin ella (o sin saberlo), fuera el circulo.
          if (user) setProfileHint(true)
          else if (data) setProfileHint(false)
          else delete document.documentElement.dataset.socio
        })
        .catch(() => {
          if (alive) delete document.documentElement.dataset.socio
        })
    load()
    // Al volver atras a una pagina guardada entera, la sesion puede haber cambiado (entrar o salir).
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) load()
    }
    window.addEventListener('pageshow', onShow)
    return () => {
      alive = false
      window.removeEventListener('pageshow', onShow)
    }
  }, [zone])

  // Un menu abierto cierra el otro (en el movil, el perfil y el de la web se pisarian).
  const toggleAccount = useCallback((open: boolean) => {
    setAccountOpen(open)
    if (open) setIsMobileOpen(false)
  }, [])
  const signedOut = useCallback(() => {
    setProfileHint(false)
    focusLogin.current = true
    setAccount('guest')
  }, [])

  // Al cambiar de pagina (tambien con la flecha de atras), los menus se cierran.
  useEffect(() => {
    setIsMobileOpen(false)
    setAccountOpen(false)
  }, [barePath])

  // Tras cerrar la sesion desde el menu, el foco pasa a Entrar (el boton del perfil ya no esta).
  useEffect(() => {
    if (account === 'guest' && focusLogin.current) {
      focusLogin.current = false
      loginRef.current?.focus()
    }
  }, [account])

  // La misma pagina en el otro idioma: las rutas no cambian, solo el prefijo /en.
  const path = barePath === '/' ? '' : barePath
  const altLocale = locale === 'en' ? 'es' : 'en'
  const altHref = localePath(altLocale, path)
  const current = localePath(locale, path)
  const closeMobile = () => setIsMobileOpen(false)

  const navLinks = [
    { href: localePath(locale, '/funciones'), label: t('comoFunciona') },
    { href: localePath(locale, '/precios'), label: t('precios') },
    { href: localePath(locale, '/seguridad'), label: t('seguridad') },
    { href: localePath(locale, '/contacto'), label: t('contacto') },
  ]

  const isActive = (href: string) => current === href
  const loginHref = localePath(locale, '/zona/entrar')
  // Escondida solo al bajar en las pantallas bajas, y nunca con un menu abierto o con el foco dentro.
  const hidden = isHidden && !isMobileOpen && !accountOpen

  return (
    <header
      onFocusCapture={() => setIsHidden(false)}
      className={cn(
        'fixed top-0 left-0 right-0 z-50 transition-[background-color,border-color,translate] duration-300 motion-reduce:transition-none',
        isMobileOpen ? 'bg-surface border-b border-line' : isScrolled ? 'bg-surface/90 backdrop-blur-md border-b border-line' : 'bg-transparent',
        hidden && '-translate-y-full'
      )}
    >
      <nav className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-3">
        {/* La empresa, con su simbolo, y debajo el producto: siempre en una linea cada uno. */}
        <Link href={localePath(locale)} onClick={closeMobile} className="flex min-h-11 shrink-0 items-center gap-2.5" aria-label={t('home')}>
          <PymaticMark className="h-9 w-auto text-ink" />
          <span className="flex flex-col whitespace-nowrap">
            <span className="text-[17px] font-bold leading-tight tracking-[-0.01em] text-ink">Pymatic Labs</span>
            <span className="text-xs leading-tight text-muted">{t('brand')}</span>
          </span>
        </Link>

        <div className="hidden md:flex items-center gap-7">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={isActive(link.href) ? 'page' : undefined}
              className={cn(
                'inline-flex min-h-11 items-center text-sm transition-colors hover:text-brand',
                isActive(link.href) ? 'text-brand font-medium' : 'text-ink'
              )}
            >
              {link.label}
            </Link>
          ))}
        </div>

        <div className="flex items-center gap-2 md:gap-3">
          <div className="hidden md:flex items-center gap-3">
            <ThemeToggle />
            <Link
              href={altHref}
              hrefLang={altLocale}
              lang={altLocale}
              aria-label={t('langLabel')}
              className="inline-flex h-11 items-center text-sm font-medium text-muted hover:text-ink border border-line rounded-full px-4 bg-surface/70 dark:bg-transparent"
            >
              {t('langSwitch')}
            </Link>
            {/* Entre md y lg no cabe todo: el enlace Precios ya esta en la barra. */}
            <Button className="hidden lg:inline-flex h-11 px-5" asChild>
              <Link href={localePath(locale, '/precios')}>{t('cta')}</Link>
            </Button>
          </div>

          {/* Arriba a la derecha (en el movil, junto al menu): Entrar o, con sesion, el perfil. Los dos
              en el mismo hueco, el de Entrar (lo mide su copia invisible): al saber la sesion, la barra
              no se mueve. */}
          {account !== 'hidden' && (
            <div className="grid items-center justify-items-end">
              <span aria-hidden="true" className={cn(LOGIN_PILL, 'invisible col-start-1 row-start-1')}>
                <UserRound className="h-4 w-4" />
                <span className={LOGIN_LABEL}>{t('login')}</span>
              </span>
              {account === 'guest' ? (
                <>
                  {/* Quien ya entro en este navegador: un circulo neutro mientras se pregunta (globals.css). */}
                  <span aria-hidden="true" className="nav-ghost col-start-1 row-start-1 h-11 w-11 rounded-full border border-line bg-paper-2" />
                  <Link
                    ref={loginRef}
                    href={loginHref}
                    onClick={closeMobile}
                    aria-label={t('loginLabel')}
                    aria-current={isActive(loginHref) ? 'page' : undefined}
                    className={cn(
                      LOGIN_PILL,
                      'nav-login col-start-1 row-start-1 bg-surface/70 transition-colors hover:border-brand hover:text-brand dark:bg-transparent',
                      // En la propia pagina de entrar, se ve que ya se esta ahi.
                      isActive(loginHref) ? 'border-brand text-brand' : 'border-field/50 text-ink'
                    )}
                  >
                    <UserRound className="h-4 w-4" aria-hidden="true" />
                    <span className={LOGIN_LABEL}>{t('login')}</span>
                  </Link>
                </>
              ) : (
                <div className="col-start-1 row-start-1 justify-self-stretch">
                  <AccountMenu profile={account} open={accountOpen} onToggle={toggleAccount} onSignedOut={signedOut} />
                </div>
              )}
            </div>
          )}

          <button
            ref={menuButtonRef}
            type="button"
            className="-mr-2 flex h-11 w-11 items-center justify-center text-ink md:hidden"
            onClick={() => {
              setIsMobileOpen(!isMobileOpen)
              setAccountOpen(false)
            }}
            aria-label={isMobileOpen ? t('closeMenu') : t('openMenu')}
            aria-expanded={isMobileOpen}
            aria-controls={isMobileOpen ? mobileMenuId : undefined}
          >
            {/* Las rayas y la cruz, una en lugar de la otra con un fundido corto */}
            <span className="relative h-6 w-6" aria-hidden="true">
              <Menu className={cn(MENU_ICON, isMobileOpen && MENU_ICON_OFF)} />
              <X className={cn(MENU_ICON, !isMobileOpen && MENU_ICON_OFF)} />
            </span>
          </button>
        </div>
      </nav>

      {/* El menu del movil: toda la pantalla bajo la barra, los enlaces en grande arriba y, abajo, al alcance
          del pulgar, Ver precios, el tema y el idioma. Si no cabe (en horizontal o con la letra muy grande),
          se desplaza dentro. */}
      {isMobileOpen && (
        <div
          id={mobileMenuId}
          className="absolute inset-x-0 top-full flex h-[calc(100dvh-4rem)] flex-col overflow-y-auto overscroll-contain bg-surface px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-3 motion-safe:animate-[menu-in_0.3s_cubic-bezier(0.2,0.7,0.2,1)_both] sm:px-6 md:hidden"
        >
          <ul>
            {navLinks.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  aria-current={isActive(link.href) ? 'page' : undefined}
                  className={cn(
                    'flex min-h-14 items-center text-[1.75rem] font-semibold tracking-[-0.025em] transition-opacity active:opacity-60',
                    isActive(link.href) ? 'text-brand' : 'text-ink'
                  )}
                  onClick={closeMobile}
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
          <div className="mt-auto space-y-4 pt-8">
            <Button size="lg" className="h-13 w-full text-[17px]" asChild>
              <Link href={localePath(locale, '/precios')} onClick={closeMobile}>
                {t('cta')}
              </Link>
            </Button>
            <div className="flex items-center gap-3">
              <ThemeToggle />
              <Link
                href={altHref}
                hrefLang={altLocale}
                lang={altLocale}
                aria-label={t('langLabel')}
                className="inline-flex h-11 items-center rounded-full border border-line px-4 text-sm font-medium text-muted"
              >
                {t('langSwitch')}
              </Link>
            </div>
          </div>
        </div>
      )}
    </header>
  )
}

/**
 * La forma del boton Entrar (y de su copia invisible, que da el ancho del hueco), siempre en una linea. En
 * los moviles mas estrechos, solo el icono en un circulo (el nombre lo lleva su aria-label): asi caben la
 * marca y el menu sin partirse.
 */
const LOGIN_PILL =
  'inline-flex h-11 items-center gap-2 whitespace-nowrap rounded-full border px-4 text-sm font-medium max-[379px]:w-11 max-[379px]:justify-center max-[379px]:px-0'
const LOGIN_LABEL = 'max-[379px]:hidden'

/** El icono del boton del menu: el que no toca, encogido, transparente y desenfocado. */
const MENU_ICON = 'absolute inset-0 h-6 w-6 transition-[opacity,scale,filter] duration-200 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none'
const MENU_ICON_OFF = 'scale-25 opacity-0 blur-[4px]'

const SHORTCUT_ICONS = { licencia: KeyRound, descargas: Download, facturas: Receipt }

/**
 * El perfil de quien entro: un boton con sus iniciales (o las de su empresa) que abre un menu con su
 * correo y su empresa, la zona de socio, sus atajos y cerrar la sesion. Es un desplegable de enlaces:
 * se recorre con el tabulador (y con las flechas) y se cierra con Escape, al pulsar fuera o al salir
 * de el con el foco.
 */
function AccountMenu({
  profile,
  open,
  onToggle,
  onSignedOut,
}: {
  profile: ZoneProfile
  open: boolean
  onToggle: (open: boolean) => void
  onSignedOut: () => void
}) {
  const t = useTranslations('nav.account')
  const locale = useLocale()
  const barePath = useBarePath()
  const current = localePath(locale, barePath === '/' ? '' : barePath)
  const panelId = useId()
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLElement>(null)
  const focusFirst = useRef(false)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  const company = profile.companies[0]?.name ?? null
  const more = profile.companies.length - 1
  const initials = profileInitials(company, profile.email)
  const links = [
    { href: localePath(locale, '/zona'), label: t('zone'), Icon: LayoutGrid },
    ...profileShortcuts(profile).map((s) => ({ href: localePath(locale, `/zona/${s}`), label: t(s), Icon: SHORTCUT_ICONS[s] })),
  ]

  useEffect(() => {
    if (!open) return
    if (focusFirst.current) {
      focusFirst.current = false
      panel.current?.querySelector<HTMLElement>('a, button')?.focus()
    }
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) onToggle(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      onToggle(false)
      button.current?.focus()
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onToggle])

  // Flechas arriba y abajo entre las opciones, Inicio y Fin a la primera y la ultima (el tabulador tambien vale).
  function onPanelKey(e: React.KeyboardEvent<HTMLElement>) {
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('a, button'))
    const at = items.indexOf(document.activeElement as HTMLElement)
    const next = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: items.length - 1 }[e.key]
    if (next === undefined) return
    e.preventDefault()
    items[(next + items.length) % items.length]?.focus()
  }

  async function logout() {
    setBusy(true)
    setFailed(false)
    try {
      const res = await fetch('/api/zone/logout', { method: 'POST' })
      // Sin sesion ya (401), se da por cerrada.
      if (!res.ok && res.status !== 401) throw new Error(String(res.status))
      setProfileHint(false)
      // En la zona, a entrar (sus paginas se pintan con la sesion); en las demas solo cambia la barra.
      if (ZONE_PAGE.test(barePath)) {
        window.location.assign(localePath(locale, '/zona/entrar'))
        return
      }
      onToggle(false)
      onSignedOut()
    } catch {
      setFailed(true)
    }
    setBusy(false)
  }

  return (
    <div
      ref={root}
      className="w-full md:relative"
      onBlur={(e) => {
        // El foco se va fuera (con el tabulador): se cierra. Un clic dentro no cuenta.
        if (open && e.relatedTarget && !root.current?.contains(e.relatedTarget as Node)) onToggle(false)
      }}
    >
      <button
        ref={button}
        type="button"
        aria-label={t('button', { email: profile.email, initials })}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => {
          setFailed(false)
          onToggle(!open)
        }}
        onKeyDown={(e) => {
          // Flecha abajo: abre (si no lo esta) y va a la primera opcion.
          if (e.key !== 'ArrowDown') return
          e.preventDefault()
          if (open) {
            panel.current?.querySelector<HTMLElement>('a, button')?.focus()
            return
          }
          setFailed(false)
          focusFirst.current = true
          onToggle(true)
        }}
        className={cn(
          // Del ancho de Entrar (llena su hueco) y con su mismo contorno; las iniciales, en un azul suave,
          // no lleno: el boton azul lleno de la barra es solo el de Ver precios.
          'inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-full border bg-surface/70 px-2 text-ink transition-colors hover:border-brand dark:bg-transparent max-[379px]:px-0',
          open ? 'border-brand ring-2 ring-brand/30' : 'border-field/50'
        )}
      >
        <span aria-hidden="true" className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-soft text-sm font-semibold tracking-wide text-brand dark:bg-brand/20">
          {initials}
        </span>
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted transition-transform max-[379px]:hidden', open && 'rotate-180')} aria-hidden="true" />
      </button>

      {open && (
        <nav
          ref={panel}
          id={panelId}
          aria-label={t('menu')}
          onKeyDown={onPanelKey}
          className="absolute top-full mt-2 left-4 right-4 sm:left-auto sm:right-6 sm:w-80 md:right-0 md:w-72 max-h-[calc(100dvh-5rem)] overflow-y-auto rounded-2xl border border-line bg-surface p-2 text-left shadow-xl shadow-black/10 dark:shadow-black/40"
        >
          <div className="px-3 pt-2 pb-3 border-b border-line">
            <p className="text-sm font-semibold text-ink break-all">{profile.email}</p>
            {company && (
              <p className="mt-0.5 text-sm text-muted">
                {company}
                {more > 0 && ` ${t('moreCompanies', { count: more })}`}
              </p>
            )}
          </div>
          <ul className="py-1">
            {links.map(({ href, label, Icon }) => (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={current === href ? 'page' : undefined}
                  onClick={() => onToggle(false)}
                  className={cn(
                    'flex min-h-11 items-center gap-3 rounded-xl px-3 text-base text-ink transition-colors hover:bg-paper-2 hover:text-brand',
                    // La pagina en la que se esta, marcada (no solo para el lector de pantalla).
                    'aria-[current=page]:bg-paper-2 aria-[current=page]:text-brand',
                    href === links[0].href && 'font-semibold'
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
                  {label}
                </Link>
              </li>
            ))}
          </ul>
          <div className="pt-1 border-t border-line">
            <button
              type="button"
              onClick={logout}
              disabled={busy}
              className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-base text-ink transition-colors hover:bg-paper-2 disabled:opacity-60"
            >
              <LogOut className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
              {busy ? t('loggingOut') : t('logout')}
            </button>
            {failed && (
              <p role="alert" className="px-3 pb-2 text-sm text-danger">
                {t('logoutError')}
              </p>
            )}
          </div>
        </nav>
      )}
    </div>
  )
}
