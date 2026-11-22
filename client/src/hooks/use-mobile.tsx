import * as React from "react"

export const MOBILE_BREAKPOINT = 768
/** Phone landscape is wider than 767 but still a phone (short side). */
export const PHONE_LANDSCAPE_MAX_HEIGHT_PX = 500
export const PHONE_LANDSCAPE_MAX_WIDTH_PX = 1024
/**
 * innerWidth/visualViewport can report 0–2 during iframe collapse, DevTools
 * dock, or a mid-resize transient. Those must not latch the shell.
 */
export const MIN_TRUSTED_VIEWPORT_PX = 160
const RESIZE_DEBOUNCE_MS = 100

export type TrustedViewport = { width: number; height: number }

export function readTrustedViewport(
  win: Pick<Window, "innerWidth" | "innerHeight" | "visualViewport"> & {
    document?: { documentElement?: { clientWidth: number; clientHeight: number } }
  } = window,
): TrustedViewport | null {
  const vv = win.visualViewport
  const el = win.document?.documentElement
  const width = Math.round(
    Math.max(vv?.width || 0, win.innerWidth || 0, el?.clientWidth || 0),
  )
  const height = Math.round(
    Math.max(vv?.height || 0, win.innerHeight || 0, el?.clientHeight || 0),
  )
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < MIN_TRUSTED_VIEWPORT_PX ||
    height < MIN_TRUSTED_VIEWPORT_PX
  ) {
    return null
  }
  return { width, height }
}

/** Both directions. Untrusted reads keep `previous` so a 2px blip cannot latch. */
export function resolveIsMobileViewport(
  viewport: TrustedViewport | null,
  previous: boolean,
): boolean {
  if (!viewport) return previous
  if (viewport.width < MOBILE_BREAKPOINT) return true
  if (
    viewport.height < PHONE_LANDSCAPE_MAX_HEIGHT_PX &&
    viewport.width < PHONE_LANDSCAPE_MAX_WIDTH_PX
  ) {
    return true
  }
  return false
}

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean>(() =>
    typeof window !== "undefined"
      ? resolveIsMobileViewport(readTrustedViewport(), false)
      : false,
  )

  React.useEffect(() => {
    let timer: number | null = null
    const apply = () => {
      setIsMobile((prev) => resolveIsMobileViewport(readTrustedViewport(), prev))
    }
    const schedule = () => {
      if (timer != null) window.clearTimeout(timer)
      timer = window.setTimeout(apply, RESIZE_DEBOUNCE_MS)
    }

    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    mql.addEventListener("change", schedule)
    window.addEventListener("resize", schedule)
    window.visualViewport?.addEventListener("resize", schedule)
    apply()

    return () => {
      if (timer != null) window.clearTimeout(timer)
      mql.removeEventListener("change", schedule)
      window.removeEventListener("resize", schedule)
      window.visualViewport?.removeEventListener("resize", schedule)
    }
  }, [])

  return isMobile
}
