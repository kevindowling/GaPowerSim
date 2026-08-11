import { useEffect, useState } from 'react'

/**
 * Subscribe to a media query.
 *
 * The mobile layout is a different arrangement of the same components — map
 * full-bleed with the panels in a bottom sheet — rather than a narrower version
 * of the desktop one, so the decision has to reach React and not just CSS.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia(query).matches)

  useEffect(() => {
    const mql = window.matchMedia(query)
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches)
    setMatches(mql.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])

  return matches
}

/**
 * Below this the sidebar cannot coexist with a usable map: at 390 px the panel
 * left the canvas 73 px wide, which is not a map, it is a stripe.
 */
export const MOBILE_QUERY = '(max-width: 820px)'
