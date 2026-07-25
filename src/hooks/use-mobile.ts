import * as React from "react"

const MOBILE_BREAKPOINT = 768

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }
    mql.addEventListener("change", onChange)
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return !!isMobile
}

/** Ratón/trackpad de escritorio: no pedir cámara aunque la ventana sea estrecha. */
export function isDesktopPointerDevice(): boolean {
  if (typeof window === "undefined") return true
  const finePointer = window.matchMedia("(pointer: fine)").matches
  const hover = window.matchMedia("(hover: hover)").matches
  return finePointer && hover
}

const DESKTOP_LAYOUT_BREAKPOINT = 1024

/**
 * Cámara en vivo solo en móvil táctil.
 * En escritorio (ratón, panel lateral lg, o ventana ancha) solo se suben PDF/JPG: nunca getUserMedia.
 * Por defecto false hasta medir en cliente.
 */
export function useCalificarLiveCamera(): boolean {
  const [enabled, setEnabled] = React.useState(false)

  React.useEffect(() => {
    const update = () => {
      // Veto absoluto: PC con ratón/trackpad o layout de escritorio del dashboard.
      if (isDesktopPointerDevice()) {
        setEnabled(false)
        return
      }
      if (window.matchMedia(`(min-width: ${DESKTOP_LAYOUT_BREAKPOINT}px)`).matches) {
        setEnabled(false)
        return
      }
      const narrow = window.innerWidth < MOBILE_BREAKPOINT
      const coarse = window.matchMedia("(pointer: coarse)").matches
      const touchLike = coarse || navigator.maxTouchPoints > 0
      setEnabled(narrow && touchLike)
    }

    update()
    const narrowMq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const desktopMq = window.matchMedia(`(min-width: ${DESKTOP_LAYOUT_BREAKPOINT}px)`)
    narrowMq.addEventListener("change", update)
    desktopMq.addEventListener("change", update)
    return () => {
      narrowMq.removeEventListener("change", update)
      desktopMq.removeEventListener("change", update)
    }
  }, [])

  return enabled
}
