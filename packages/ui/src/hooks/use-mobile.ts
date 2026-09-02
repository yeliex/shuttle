import { useEffect, useState } from "react"

const DEFAULT_MOBILE_BREAKPOINT = 768

function parseCssLengthToPx(value: string): number | null {
  const normalized = value.trim()
  if (!normalized) {
    return null
  }

  if (normalized.endsWith("rem")) {
    const rem = Number.parseFloat(normalized.slice(0, -3))
    const rootFontSize = Number.parseFloat(
      getComputedStyle(document.documentElement).fontSize
    )

    return Number.isFinite(rem) && Number.isFinite(rootFontSize)
      ? rem * rootFontSize
      : null
  }

  if (normalized.endsWith("px")) {
    const pixels = Number.parseFloat(normalized.slice(0, -2))
    return Number.isFinite(pixels) ? pixels : null
  }

  const pixels = Number.parseFloat(normalized)
  return Number.isFinite(pixels) ? pixels : null
}

function getMobileBreakpointPx(): number {
  const breakpoint = getComputedStyle(document.documentElement)
    .getPropertyValue("--breakpoint-md")

  return parseCssLengthToPx(breakpoint) ?? DEFAULT_MOBILE_BREAKPOINT
}

export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const breakpoint = getMobileBreakpointPx()
    const mediaQuery = window.matchMedia(`(max-width: ${breakpoint - 1}px)`)
    const update = () => setIsMobile(mediaQuery.matches)

    mediaQuery.addEventListener("change", update)
    update()

    return () => mediaQuery.removeEventListener("change", update)
  }, [])

  return isMobile
}
