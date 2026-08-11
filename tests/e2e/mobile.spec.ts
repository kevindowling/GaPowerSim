import { test, expect, type Page } from '@playwright/test'

/**
 * The phone layout.
 *
 * These exist because the desktop layout did not degrade on a phone, it failed:
 * a fixed 292 px sidebar left the map canvas 73 px wide, and four HUD stats in a
 * row printed on top of each other. The assertions below are the properties that
 * stopped that being true.
 */

async function sign(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Sign the contract' }).click()
  await expect(page.locator('.briefing')).toHaveCount(0)
  await page.waitForTimeout(1200) // let the camera glide settle
}

test('gives the map the whole screen', async ({ page }) => {
  await page.goto('/')
  await sign(page)

  const vw = page.viewportSize()!.width
  const canvas = (await page.locator('canvas.map-canvas').boundingBox())!
  // The map is the interface on a phone — you draw a corridor by touching two
  // points on it, which is impossible on a stripe.
  expect(canvas.width).toBeGreaterThan(vw * 0.95)

  // The desktop sidebar and log strip are gone entirely.
  await expect(page.locator('.sidebar')).toHaveCount(0)
  await expect(page.locator('.logstrip')).toHaveCount(0)
})

test('never scrolls sideways', async ({ page }) => {
  await page.goto('/')
  await sign(page)
  const { scrollW, innerW } = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    innerW: window.innerWidth,
  }))
  expect(scrollW).toBeLessThanOrEqual(innerW)
})

test('keeps the HUD legible instead of overprinting it', async ({ page }) => {
  await page.goto('/')
  await sign(page)

  // Every stat renders inside the HUD's own box, none spilling over a neighbour.
  const overlapping = await page.evaluate(() => {
    const stats = [...document.querySelectorAll('.hud .stat')].map((e) => e.getBoundingClientRect())
    let hits = 0
    for (let i = 0; i < stats.length; i++) {
      for (let j = i + 1; j < stats.length; j++) {
        const a = stats[i]
        const b = stats[j]
        if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) hits++
      }
    }
    return hits
  })
  expect(overlapping).toBe(0)
  await expect(page.locator('.hud')).toContainText('400 MW')
})

test('puts the panels in a sheet that opens and closes', async ({ page }) => {
  await page.goto('/')
  await sign(page)

  // Collapsed by default: the player lands on the map, not a wall of panels.
  await expect(page.locator('.sheet-body')).toBeHidden()

  await page.getByRole('tab', { name: /Build/ }).click()
  await expect(page.locator('.sheet-body')).toBeVisible()
  await expect(page.getByRole('button', { name: /Gas combustion turbine/ })).toBeVisible()

  // Tapping the active tab again collapses it — one touch back to a full map.
  await page.getByRole('tab', { name: /Build/ }).click()
  await expect(page.locator('.sheet-body')).toBeHidden()
})

test('switches between panels by tab', async ({ page }) => {
  await page.goto('/')
  await sign(page)

  await page.getByRole('tab', { name: /Grid/ }).click()
  await expect(page.getByRole('heading', { name: 'Transmission' })).toBeVisible()

  await page.getByRole('tab', { name: /Deal/ }).click()
  await expect(page.getByRole('heading', { name: 'The deal' })).toBeVisible()

  await page.getByRole('tab', { name: /Log/ }).click()
  await expect(page.locator('.logstrip')).toBeVisible()
})

test('hides the coach behind the sheet rather than under it', async ({ page }) => {
  await page.goto('/')
  await sign(page)
  await expect(page.locator('.coach')).toBeVisible()

  await page.getByRole('tab', { name: /Build/ }).click()
  // It used to render underneath the sheet, which is worse than not rendering.
  await expect(page.locator('.coach')).toBeHidden()

  await page.getByRole('tab', { name: /Build/ }).click()
  await expect(page.locator('.coach')).toBeVisible()
})

test('lets the coach collapse so it stops covering the map', async ({ page }) => {
  await page.goto('/')
  await sign(page)

  const before = (await page.locator('.coach').boundingBox())!
  await page.getByRole('button', { name: 'Collapse the hint' }).click()
  const after = (await page.locator('.coach').boundingBox())!
  expect(after.height).toBeLessThan(before.height * 0.6)

  // The title and progress stay, so the player knows where they are.
  await expect(page.locator('.coach-title')).toBeVisible()
})

test('has thumb-sized controls', async ({ page }) => {
  await page.goto('/')
  await sign(page)
  await page.getByRole('tab', { name: /Build/ }).click()

  const tooSmall = await page.evaluate(() => {
    const els = [...document.querySelectorAll('button, [role=tab]')]
    return els
      .map((e) => ({ cls: e.className, r: e.getBoundingClientRect() }))
      .filter((x) => x.r.width > 0 && x.r.height > 0 && x.r.height < 32)
      .map((x) => `${x.cls}: ${Math.round(x.r.width)}x${Math.round(x.r.height)}`)
  })
  expect(tooSmall).toEqual([])
})

test('can site a plant by tapping the map', async ({ page }) => {
  await page.goto('/')
  await sign(page)

  await page.getByRole('tab', { name: /Build/ }).click()
  await page.getByRole('button', { name: /Gas combustion turbine/ }).click()
  // Selecting a plant collapses nothing, so close the sheet to reach the map.
  await page.getByRole('tab', { name: /Build/ }).click()

  const box = (await page.locator('canvas.map-canvas').boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.4)

  await page.getByRole('tab', { name: /Deal/ }).click()
  await expect(page.locator('.fleet li')).toHaveCount(1)
})

test('shows modals full-screen', async ({ page }) => {
  await page.goto('/')
  const briefing = page.locator('.briefing')
  await expect(briefing).toBeVisible()

  const vw = page.viewportSize()!.width
  const box = (await briefing.boundingBox())!
  expect(box.width).toBeGreaterThan(vw * 0.95)
  await expect(briefing).toContainText('400 MW')
  await expect(page.getByRole('button', { name: 'Sign the contract' })).toBeVisible()
})
