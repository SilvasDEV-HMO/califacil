const MOBILE_BREAKPOINT = 768
const DESKTOP_LAYOUT_BREAKPOINT = 1024

/** Ratón/trackpad de escritorio: no pedir cámara aunque la ventana sea estrecha. */
export function isDesktopPointerDevice(): boolean {
  if (typeof window === 'undefined') return true
  const finePointer = window.matchMedia('(pointer: fine)').matches
  const hover = window.matchMedia('(hover: hover)').matches
  return finePointer && hover
}

/**
 * Cámara en vivo solo en teléfono táctil estrecho.
 * El dashboard de escritorio (lg / ratón) nunca debe llamar getUserMedia.
 */
export function canRequestCalificarLiveCamera(): boolean {
  if (typeof window === 'undefined') return false
  if (window.matchMedia(`(min-width: ${DESKTOP_LAYOUT_BREAKPOINT}px)`).matches) return false
  if (isDesktopPointerDevice()) return false
  const narrow = window.innerWidth < MOBILE_BREAKPOINT
  const coarse = window.matchMedia('(pointer: coarse)').matches
  const touchLike = coarse || navigator.maxTouchPoints > 0
  return narrow && touchLike
}
