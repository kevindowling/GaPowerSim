import { onlyLiberty } from './helpers.ts'
import { test, expect, type Page } from '@playwright/test'

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
  await page.getByRole('button', { name: 'Start', exact: true }).click()
  await expect(page.locator('dialog.briefing')).toHaveCount(0)
  await onlyLiberty(page)
}

test('loads the vendored map and paints Georgia', { tag: '@smoke' }, async ({ page }) => {
  const consoleErrors: string[] = []
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })
  page.on('pageerror', (e) => consoleErrors.push(String(e)))

  await page.goto('/?seed=7')
  await expect(page.locator('canvas.map-canvas')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Georgia Power, August 2026' })).toBeVisible()

  await signContract(page)
  await page.waitForTimeout(700)

  const colours = await canvasColours(page)
  expect(colours.length).toBeGreaterThan(4)

  expect(consoleErrors).toEqual([])
  await page.screenshot({ path: 'tests/.artifacts/statewide.png' })
})

test('makes no requests to external hosts', { tag: '@smoke' }, async ({ page }) => {
  const external: string[] = []
  page.on('request', (r) => {
    const url = new URL(r.url())
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') external.push(r.url())
  })

  await page.goto('/?seed=7')
  await page.waitForSelector('canvas.map-canvas')
  await signContract(page)
  await page.waitForTimeout(900)

  expect(external).toEqual([])
})

test('pans and zooms', async ({ page }) => {
  await page.goto('/?seed=7')
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
  await expect(page.locator('.scalebar span')).toBeVisible()
})

test('hovering a county reports it', async ({ page }) => {
  await page.goto('/?seed=7')
  await signContract(page)
  const canvas = page.locator('canvas.map-canvas')
  await page.waitForTimeout(500)

  const box = (await canvas.boundingBox())!
  // The centre of the framed state is reliably inside Georgia.
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.75)
  await page.waitForTimeout(1500)
  await page.mouse.move(box.x + box.width * 0.72, box.y + box.height * 0.75)

  await expect(page.locator('.map-tip')).toContainText('County')
})

test('embed variant drops the host-page chrome', { tag: '@smoke' }, async ({ page }) => {
  await page.goto('/embed.html')
  await expect(page.locator('canvas.map-canvas')).toBeVisible()
  await expect(page.locator('.brand')).toHaveCount(0)
})

test('works without the optional map layers', async ({ page }) => {
  await page.route(/\/data\/(basemap|roads|hydrology|gis)\//, (r) => r.fulfill({ status: 404, body: '' }))
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto('/?seed=7')
  await signContract(page)
  await page.waitForTimeout(900)
  await page.getByRole('button', { name: 'Layers' }).click()
  await expect(page.locator('.layers')).toBeVisible()
  for (const label of ['Aerial photo', 'Roads and rail', 'Rivers and lakes', 'Existing lines and substations']) {
    await expect(page.getByLabel(label)).toHaveCount(0)
  }
  await expect(page.locator('.map-attribution')).toHaveCount(0)
  expect(errors).toEqual([])
  await expect(page.locator('.plant').first()).toBeVisible()
})

test('ships streets, rivers, buildings and the existing grid', async ({ page }) => {
  await page.goto('/?seed=7')
  await signContract(page)
  await page.waitForFunction(() => (window as any).__game.getState().gis !== null)
  const n = await page.evaluate(() => {
    const s = (window as any).__game.getState()
    return {
      streets: s.roads.roads.length, named: s.roads.roads.filter((r: any) => r.name).length,
      streams: s.water.waterways.length, rivers: s.stateWater.waterways.length,
      buildings: s.gis.buildings.length, substations: s.gis.substations.length,
      power: s.stateGis.power.length, rail: s.gis.rail.length, parks: s.stateGis.parks.length,
    }
  })
  expect(n.streets).toBeGreaterThan(2000)
  expect(n.named).toBeGreaterThan(500)
  expect(n.streams).toBeGreaterThan(300)
  expect(n.rivers).toBeGreaterThan(300)
  expect(n.buildings).toBeGreaterThan(2000)
  expect(n.substations).toBeGreaterThan(10)
  expect(n.power).toBeGreaterThan(1000)
  expect(n.rail).toBeGreaterThan(20)
  expect(n.parks).toBeGreaterThan(20)
  await expect(page.locator('.map-attribution')).toContainText('OpenStreetMap')
})

test('stays responsive while zooming', async ({ page }) => {
  await page.goto('/?seed=7')
  await signContract(page)
  await page.waitForFunction(() => (window as any).__game.getState().gis !== null)
  await page.waitForTimeout(1200)
  const worst = await page.evaluate(async () => {
    const c = document.querySelector('canvas.map-canvas')!
    const r = c.getBoundingClientRect()
    const wheel = (d: number) => c.dispatchEvent(new WheelEvent('wheel', {
      deltaY: d, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, cancelable: true,
    }))
    let low = Infinity
    for (let z = 0; z < 8; z++) {
      for (let i = 0; i < 4; i++) wheel(40)
      let n = 0
      const t = performance.now()
      await new Promise<void>((done) => {
        const f = () => { n++; wheel(n % 2 ? 1 : -1); performance.now() - t < 500 ? requestAnimationFrame(f) : done() }
        requestAnimationFrame(f)
      })
      low = Math.min(low, n * 2)
    }
    return low
  })
  console.log('slowest zoom', worst, 'fps')
  expect(worst).toBeGreaterThan(6)
})

/** A 2x2 red PNG, enough to prove the imagery path decodes and draws. */
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z4AATAxQxhArEQgAAP//' +
  'DkgBc1AeuBAAAAAASUVORK5CYII=',
  'base64',
)

test('draws the aerial and road layers when they have been vendored', async ({ page }) => {
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

  await page.route('**/data/hydrology/state.json', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        version: 1,
        scope: 'state',
        scopeName: 'Georgia',
        source: 'test fixture',
        attribution: '© OpenStreetMap contributors',
        license: 'ODbL-1.0',
        waterways: [{ k: 'river', n: 'Flint River', p: [[-84.2, 32.4], [-84.1, 31.9]] }],
        bodies: [
          { k: 'lake', n: 'Lake Blackshear', p: [[-83.95, 31.9], [-83.85, 31.9], [-83.85, 32.0], [-83.95, 32.0]] },
          { k: 'wetland', p: [[-84.3, 32.0], [-84.2, 32.0], [-84.2, 32.1], [-84.3, 32.1]] },
        ],
      }),
    }))

  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))

  await page.goto('/?seed=7')
  await page.getByRole('button', { name: 'Start', exact: true }).click()

  await page.getByRole('button', { name: 'Layers' }).click()
  for (const label of ['Rivers and lakes', 'Aerial photo', 'Roads and rail']) {
    await expect(page.getByLabel(label)).toBeVisible()
  }
  const attribution = page.locator('.map-attribution')
  await expect(attribution).toContainText('OpenStreetMap contributors')
  await expect(attribution).toContainText('NAIP')

  const roadCount = await page.evaluate(() => {
    const s = (window as unknown as { __game: any }).__game.getState()
    return {
      state: s.stateRoads?.roads.length ?? 0,
      county: s.roads?.roads.length ?? 0,
    }
  })
  expect(roadCount.state).toBe(2)
  expect(roadCount.county).toBe(3)

  const waterCount = await page.evaluate(() => {
    const s = (window as unknown as { __game: any }).__game.getState()
    return { ways: s.stateWater?.waterways.length ?? 0, bodies: s.stateWater?.bodies.length ?? 0 }
  })
  expect(waterCount.ways).toBe(1)
  expect(waterCount.bodies).toBe(2)

  for (const label of ['Roads and rail', 'Rivers and lakes', 'Existing lines and substations']) {
    await expect(attribution).toContainText('OpenStreetMap')
    await page.getByLabel(label).uncheck()
  }
  await expect(attribution).not.toContainText('OpenStreetMap')
  await page.getByLabel('Aerial photo').uncheck()
  await expect(attribution).toHaveCount(0)

  expect(errors).toEqual([])
  await page.screenshot({ path: 'tests/.artifacts/basemap-layers.png' })
})
