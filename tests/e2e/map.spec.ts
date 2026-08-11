import { test, expect, type Page } from '@playwright/test'

/**
 * Smoke coverage for the map foundation. These assertions are deliberately about
 * observable behaviour rather than pixels: that the vendored data loads, that
 * something actually paints, that pan/zoom moves the view, and — the one that
 * matters for privacy — that the running game never talks to an external host.
 */

/** Sample the map canvas and return the distinct colours it painted. */
async function canvasColours(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const c = document.querySelector('canvas.map-canvas') as HTMLCanvasElement
    const ctx = c.getContext('2d')!
    const d = ctx.getImageData(0, 0, c.width, c.height).data
    const seen = new Set<string>()
    for (let i = 0; i < d.length; i += 4 * 53) {
      if (d[i + 3] === 0) continue
      seen.add(`${d[i]},${d[i + 1]},${d[i + 2]}`)
    }
    return [...seen]
  })
}

/** Get past the briefing so the map is interactive. */
export async function signContract(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Sign the contract' }).click()
  await expect(page.locator('.briefing')).toHaveCount(0)
}

test('loads the vendored map and paints Georgia', async ({ page }) => {
  const consoleErrors: string[] = []
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })
  page.on('pageerror', (e) => consoleErrors.push(String(e)))

  await page.goto('/')
  await expect(page.locator('canvas.map-canvas')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Americus' })).toBeVisible()

  await signContract(page)
  await page.waitForTimeout(700)

  const colours = await canvasColours(page)
  // Paper plus several terrain tones — a blank or single-colour canvas fails here.
  expect(colours.length).toBeGreaterThan(4)

  expect(consoleErrors).toEqual([])
  await page.screenshot({ path: 'tests/.artifacts/statewide.png' })
})

test('makes no requests to external hosts', async ({ page }) => {
  const external: string[] = []
  page.on('request', (r) => {
    const url = new URL(r.url())
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') external.push(r.url())
  })

  await page.goto('/')
  await page.waitForSelector('canvas.map-canvas')
  await signContract(page)
  await page.waitForTimeout(900)

  // County parcel portals, tile servers, fonts, analytics — none of it. All the
  // geodata is vendored, which is what keeps the embed self-contained.
  expect(external).toEqual([])
})

test('pans and zooms', async ({ page }) => {
  await page.goto('/')
  await signContract(page)
  const canvas = page.locator('canvas.map-canvas')
  await page.waitForTimeout(500)

  const before = await canvasColours(page)

  const box = (await canvas.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.wheel(0, -600)
  await page.waitForTimeout(400)

  const after = await canvasColours(page)
  expect(after.join('|')).not.toEqual(before.join('|'))
  await expect(page.locator('.scalebar-inner span')).toBeVisible()
})

test('hovering a county reports it', async ({ page }) => {
  await page.goto('/')
  await signContract(page)
  const canvas = page.locator('canvas.map-canvas')
  await page.waitForTimeout(500)

  const box = (await canvas.boundingBox())!
  // The centre of the framed state is reliably inside Georgia.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.waitForTimeout(300)

  await expect(page.locator('.readout-title')).toContainText('County')
})

test('embed variant drops the host-page chrome', async ({ page }) => {
  await page.goto('/embed.html')
  await expect(page.locator('canvas.map-canvas')).toBeVisible()
  // The event log belongs to the standalone page, not the embed.
  await expect(page.locator('.logstrip')).toHaveCount(0)
})


test('degrades gracefully when the basemap has not been vendored', async ({ page }) => {
  const failed: string[] = []
  page.on('requestfailed', (r) => failed.push(r.url()))
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))

  await page.goto('/')
  await page.getByRole('button', { name: 'Sign the contract' }).click()
  await page.waitForTimeout(900)

  // Aerial and roads are optional. Until the data is fetched they must not be
  // offered — a toggle that draws nothing is worse than a missing one — and
  // their absence must not break the map or throw.
  await expect(page.locator('.map-controls')).toBeVisible()
  await expect(page.getByLabel('Aerial')).toHaveCount(0)
  await expect(page.getByLabel('Roads')).toHaveCount(0)
  await expect(page.locator('.map-attribution')).toHaveCount(0)

  expect(errors).toEqual([])
  // A 404 on the optional basemap is expected and handled; nothing else is.
  const unexpected = failed.filter((u) => !/\/data\/(basemap|roads)\//.test(u))
  expect(unexpected).toEqual([])

  // And the game is still playable.
  await expect(page.locator('.plant-card').first()).toBeVisible()
})


/** A 2x2 red PNG, enough to prove the imagery path decodes and draws. */
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z4AATAxQxhArEQgAAP//' +
  'DkgBc1AeuBAAAAAASUVORK5CYII=',
  'base64',
)

test('draws the aerial and road layers when they have been vendored', async ({ page }) => {
  // Served from the network layer rather than committed, so the repo does not
  // ship invented roads that would look like real OSM data.
  // Statewide highways: present from startup, because the game is statewide and
  // Sumter is only the tutorial.
  await page.route('**/data/roads/state.json', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        version: 1,
        countyFips: 'state',
        countyName: 'Georgia',
        source: 'test fixture',
        attribution: '© OpenStreetMap contributors',
        license: 'ODbL-1.0',
        roads: [
          { c: 0, p: [[-84.4, 33.7], [-83.0, 32.0]] },
          { c: 1, p: [[-85.0, 31.5], [-81.5, 31.2]] },
        ],
      }),
    }))

  await page.route('**/data/roads/13261.json', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        version: 1,
        countyFips: '13261',
        countyName: 'Sumter',
        source: 'test fixture',
        attribution: '© OpenStreetMap contributors',
        license: 'ODbL-1.0',
        roads: [
          { c: 0, p: [[-84.3, 32.0], [-84.1, 32.2]] },
          { c: 2, p: [[-84.25, 32.05], [-84.15, 32.05], [-84.15, 32.18]] },
          { c: 3, p: [[-84.2, 32.1], [-84.18, 32.12]] },
        ],
      }),
    }))

  await page.route('**/data/basemap/imagery.json', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        version: 1,
        source: 'test fixture',
        attribution: 'Aerial imagery: USDA NAIP (public domain)',
        license: 'public-domain',
        capturedYear: 2023,
        tiles: [{
          file: 'test.png',
          bounds: [-60, -60, -20, -20],
          widthPx: 2,
          heightPx: 2,
          metresPerPixel: 20000,
        }],
      }),
    }))
  await page.route('**/data/basemap/test.png', (route) =>
    route.fulfill({ contentType: 'image/png', body: TINY_PNG }))

  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))

  await page.goto('/')
  await page.getByRole('button', { name: 'Sign the contract' }).click()

  // Both toggles appear only because the data resolved.
  await expect(page.getByLabel('Aerial')).toBeVisible()
  await expect(page.getByLabel('Roads')).toBeVisible()

  // ODbL requires the attribution to be shown, so it is on the map itself.
  const attribution = page.locator('.map-attribution')
  await expect(attribution).toContainText('OpenStreetMap contributors')
  await expect(attribution).toContainText('NAIP')

  // Both tiers reached the renderer, not just one of them.
  const roadCount = await page.evaluate(() => {
    const s = (window as unknown as { __game: any }).__game.getState()
    return {
      state: s.stateRoads?.roads.length ?? 0,
      county: s.roads?.roads.length ?? 0,
    }
  })
  expect(roadCount.state).toBe(2)
  expect(roadCount.county).toBe(3)

  // Turning a layer off removes its attribution with it.
  await page.getByLabel('Roads').uncheck()
  await expect(attribution).not.toContainText('OpenStreetMap')
  await page.getByLabel('Aerial').uncheck()
  await expect(attribution).toHaveCount(0)

  expect(errors).toEqual([])
  await page.screenshot({ path: 'tests/.artifacts/basemap-layers.png' })
})
