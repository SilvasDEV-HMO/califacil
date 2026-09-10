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

/**
 * Calificar ya no usa getUserMedia: móvil y desktop suben foto/PDF
 * y se califican con el mismo pipeline OMR de escritorio.
 */
export function useCalificarLiveCamera(): boolean {
  return false
}
