import { describe, it, expect } from 'vitest'
import {
  overpassQuery, explainStatus, USER_AGENT, OVERPASS_ENDPOINTS,
} from '../scripts/lib/overpass.ts'

const ok = (payload: unknown = { elements: [] }): Response =>
  new Response(JSON.stringify(payload), { status: 200 })

const status = (code: number): Response => new Response('', { status: code })

/** No real waiting: backoff would otherwise make this suite minutes long. */
const noSleep = async (): Promise<void> => {}

describe('the Overpass client', () => {
  it('form-encodes the query as `data=`, not a bare body', async () => {
    let seen: RequestInit | undefined
    await overpassQuery('out;', {
      endpoints: ['https://example.test/api'],
      fetchImpl: async (_url, init) => { seen = init; return ok() },
      sleep: noSleep,
    })

    expect(seen?.method).toBe('POST')
    const headers = seen?.headers as Record<string, string>
    expect(headers['Content-Type']).toBe('application/x-www-form-urlencoded')
    // The body must be encoded, and must round-trip back to the query.
    expect(String(seen?.body)).toBe('data=out%3B')
    expect(new URLSearchParams(String(seen?.body)).get('data')).toBe('out;')
  })

  it('identifies itself, because the OSM policy requires it', async () => {
    let headers: Record<string, string> = {}
    await overpassQuery('out;', {
      endpoints: ['https://example.test/api'],
      fetchImpl: async (_url, init) => {
        headers = init?.headers as Record<string, string>
        return ok()
      },
      sleep: noSleep,
    })

    expect(headers['User-Agent']).toBe(USER_AGENT)
    expect(USER_AGENT).toMatch(/https?:\/\//)
  })

  it('retries a rate-limit and succeeds', async () => {
    let calls = 0
    const result = await overpassQuery('out;', {
      endpoints: ['https://example.test/api'],
      attempts: 3,
      sleep: noSleep,
      fetchImpl: async () => {
        calls++
        return calls < 3 ? status(429) : ok({ elements: [{ type: 'way' }] })
      },
    })

    expect(calls).toBe(3)
    expect((result as { elements: unknown[] }).elements).toHaveLength(1)
  })

  it('backs off for longer each attempt', async () => {
    const waits: number[] = []
    await overpassQuery('out;', {
      endpoints: ['https://example.test/api'],
      attempts: 4,
      sleep: async (ms) => { waits.push(ms) },
      fetchImpl: (() => {
        let n = 0
        return async () => (++n < 4 ? status(504) : ok())
      })(),
    }).catch(() => {})

    expect(waits.length).toBeGreaterThanOrEqual(2)
    for (let i = 1; i < waits.length; i++) expect(waits[i]).toBeGreaterThan(waits[i - 1])
  })

  it('does not retry a 406: the request is wrong, not the timing', async () => {
    let calls = 0
    await expect(overpassQuery('out;', {
      endpoints: ['https://example.test/api'],
      attempts: 3,
      sleep: noSleep,
      fetchImpl: async () => { calls++; return status(406) },
    })).rejects.toThrow(/406/)

    expect(calls).toBe(1)
  })

  it('fails over to the next mirror', async () => {
    const tried: string[] = []
    const result = await overpassQuery('out;', {
      endpoints: ['https://a.test', 'https://b.test'],
      attempts: 1,
      sleep: noSleep,
      fetchImpl: async (url) => {
        tried.push(String(url))
        return String(url).includes('a.test') ? status(504) : ok()
      },
    })

    expect(tried).toEqual(['https://a.test', 'https://b.test'])
    expect(result).toEqual({ elements: [] })
  })

  it('survives a mirror that refuses the connection outright', async () => {
    const result = await overpassQuery('out;', {
      endpoints: ['https://dead.test', 'https://live.test'],
      attempts: 2,
      sleep: noSleep,
      fetchImpl: async (url) => {
        if (String(url).includes('dead.test')) throw new Error('ECONNREFUSED')
        return ok()
      },
    })
    expect(result).toEqual({ elements: [] })
  })

  it('names the real cause instead of blaming the network', () => {
    expect(explainStatus(403)).toMatch(/egress proxy/)
    expect(explainStatus(406)).toMatch(/form-encoded|User-Agent/)
    expect(explainStatus(406)).not.toMatch(/egress/)
    expect(explainStatus(429)).toMatch(/rate-limit/)
    expect(explainStatus(429)).not.toMatch(/egress/)
    expect(explainStatus(400)).toMatch(/bug in the query/)
    expect(explainStatus(504)).toMatch(/timed out/)
  })

  it('ships more than one mirror, all https', () => {
    expect(OVERPASS_ENDPOINTS.length).toBeGreaterThan(1)
    for (const e of OVERPASS_ENDPOINTS) expect(e).toMatch(/^https:\/\//)
  })
})
