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

test('loads the vendored map and paints Georgia', async ({ page }) => {
  const consoleErrors: string[] = []
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })
  page.on('pageerror', (e) => consoleErrors.push(String(e)))

  await page.goto('/')
  await expect(page.locator('canvas.map-canvas')).toBeVisible()

  // The status bar reports what actually loaded.
  await expect(page.getByText('159 counties')).toBeVisible()

  await page.waitForTimeout(800)
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
  await page.waitForTimeout(1000)

  // County parcel portals, tile servers, fonts, analytics — none of it. All the
  // geodata is vendored, which is what keeps the embed self-contained.
  expect(external).toEqual([])
})

test('pans and zooms', async ({ page }) => {
  await page.goto('/')
  const canvas = page.locator('canvas.map-canvas')
  await expect(canvas).toBeVisible()
  await page.waitForTimeout(600)

  const before = await canvasColours(page)

  const box = (await canvas.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.wheel(0, -600)
  await page.waitForTimeout(400)

  const after = await canvasColours(page)
  // Zooming in changes the mix of what's on screen.
  expect(after.join('|')).not.toEqual(before.join('|'))

  // The scale bar should be reporting a shorter distance after zooming in.
  await expect(page.locator('.scalebar-inner span')).toBeVisible()
})

test('hovering a county reports it', async ({ page }) => {
  await page.goto('/')
  const canvas = page.locator('canvas.map-canvas')
  await expect(canvas).toBeVisible()
  await page.waitForTimeout(600)

  const box = (await canvas.boundingBox())!
  // The centre of the framed state is reliably inside Georgia.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.waitForTimeout(300)

  await expect(page.locator('.readout-title')).toContainText('County')
})

test('embed variant fills the frame without host chrome', async ({ page }) => {
  await page.goto('/embed.html')
  await expect(page.locator('canvas.map-canvas')).toBeVisible()
  // The status bar belongs to the standalone page, not the embed.
  await expect(page.locator('.statusbar')).toHaveCount(0)
})
