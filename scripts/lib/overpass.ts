/** Public mirrors, tried in order. The main endpoint is the busiest. */
export const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
]

export const USER_AGENT = process.env.OVERPASS_USER_AGENT
  ?? 'GaPowerSim/0.1 (data pipeline; +https://github.com/kevindowling/GaPowerSim)'

const RETRYABLE = new Set([429, 502, 503, 504])

export interface OverpassOptions {
  /** Endpoints to try. Defaults to the public mirrors. */
  endpoints?: string[]
  /** Attempts per endpoint before moving on. */
  attempts?: number
  /** Injected for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch
  /** Injected for tests, so backoff does not make the suite slow. */
  sleep?: (ms: number) => Promise<void>
  /** Progress reporting. */
  log?: (message: string) => void
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

/** What a given status means, in terms the reader can act on. */
export function explainStatus(status: number): string {
  switch (status) {
    case 400:
      return 'Overpass rejected the query as malformed (400). This is a bug in the query, not the network.'
    case 403:
    case 407:
      return 'Blocked before reaching Overpass (403/407): an egress proxy denied the request. '
        + 'Run the "Fetch map data" GitHub workflow instead, or fetch elsewhere and use --file.'
    case 406:
      return 'Overpass refused the request shape (406). The query must be form-encoded as '
        + '`data=` and the client must send a descriptive User-Agent.'
    case 429:
      return 'Overpass is rate-limiting this client (429). It allows very few concurrent '
        + 'queries; wait a few minutes and try again.'
    case 504:
      return 'Overpass timed out running the query (504). Statewide queries are expensive: '
        + 'try again, or narrow the area.'
    default:
      return `Overpass returned ${status}.`
  }
}

export async function overpassQuery(
  query: string, opts: OverpassOptions = {},
): Promise<unknown> {
  const endpoints = opts.endpoints ?? OVERPASS_ENDPOINTS
  const attempts = opts.attempts ?? 3
  const doFetch = opts.fetchImpl ?? fetch
  const sleep = opts.sleep ?? defaultSleep
  const log = opts.log ?? (() => {})

  let lastStatus = 0
  let lastError: string | null = null

  for (const endpoint of endpoints) {
    for (let attempt = 1; attempt <= attempts; attempt++) {
      let res: Response
      try {
        res = await doFetch(endpoint, {
          method: 'POST',
          headers: {
            // Both of these are load-bearing. See the note at the top.
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': USER_AGENT,
            Accept: 'application/json',
          },
          body: new URLSearchParams({ data: query }).toString(),
        })
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err)
        log(`  ${endpoint}: ${lastError}`)
        break // A transport failure means this mirror is unreachable; move on.
      }

      if (res.ok) return res.json()

      lastStatus = res.status
      if (!RETRYABLE.has(res.status)) {
        log(`  ${endpoint}: ${explainStatus(res.status)}`)
        break
      }

      if (attempt < attempts) {
        const waitMs = 5_000 * 2 ** (attempt - 1)
        log(`  ${endpoint}: ${res.status}, retrying in ${waitMs / 1000}s ` +
          `(attempt ${attempt} of ${attempts})`)
        await sleep(waitMs)
      } else {
        log(`  ${endpoint}: ${explainStatus(res.status)}`)
      }
    }
  }

  throw new Error(
    (lastStatus ? explainStatus(lastStatus) : `Could not reach Overpass: ${lastError}`) +
    `\nTried ${endpoints.length} mirror(s), ${attempts} attempt(s) each.` +
    `\nAs a fallback, download the extract elsewhere and re-run with --file.`,
  )
}
