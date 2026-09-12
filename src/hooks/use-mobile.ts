import * as React from "react"
import { canRequestCalificarLiveCamera } from "@/lib/calificarLiveCamera"

export { canRequestCalificarLiveCamera, isDesktopPointerDevice } from "@/lib/calificarLiveCamera"

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

/**
 * Cámara en vivo solo en móvil táctil.
 * En escritorio (ratón o layout lg) no se pide getUserMedia: solo PDF/JPG.
 */
export function useCalificarLiveCamera(): boolean {
  const [enabled, setEnabled] = React.useState(false)

  React.useEffect(() => {
    const update = () => setEnabled(canRequestCalificarLiveCamera())

    update()
    const narrowMq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const desktopMq = window.matchMedia("(min-width: 1024px)")
    const fineMq = window.matchMedia("(pointer: fine)")
    const hoverMq = window.matchMedia("(hover: hover)")
    const coarseMq = window.matchMedia("(pointer: coarse)")
    for (const mq of [narrowMq, desktopMq, fineMq, hoverMq, coarseMq]) {
      mq.addEventListener("change", update)
    }
    return () => {
      for (const mq of [narrowMq, desktopMq, fineMq, hoverMq, coarseMq]) {
        mq.removeEventListener("change", update)
      }
    }
  }, [])

  return enabled
}
