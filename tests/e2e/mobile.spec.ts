import { test, expect, type Page } from '@playwright/test'
import { onlyLiberty } from './helpers.ts'

async function sign(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Start', exact: true }).click()
  await expect(page.locator('dialog.briefing')).toHaveCount(0)
  await onlyLiberty(page)
  await page.waitForTimeout(1200) // let the camera glide settle
}

test('gives the map the whole screen', async ({ page }) => {
  await page.goto('/?seed=7')
  await sign(page)

  const vw = page.viewportSize()!.width
  const canvas = (await page.locator('canvas.map-canvas').boundingBox())!
  expect(canvas.width).toBeGreaterThan(vw * 0.95)

  await expect(page.locator('.sidebar')).toHaveCount(0)
})

test('never scrolls sideways', { tag: '@smoke' }, async ({ page }) => {
  await page.goto('/?seed=7')
  await sign(page)
  const { scrollW, innerW } = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    innerW: window.innerWidth,
  }))
  expect(scrollW).toBeLessThanOrEqual(innerW)
})

test('keeps the HUD legible instead of overprinting it', async ({ page }) => {
  await page.goto('/?seed=7')
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
  await expect(page.locator('.hud')).toContainText('Cash')
})

test('shows power at the campus', async ({ page }) => {
  await page.goto('/?seed=7')
  await sign(page)
  await page.getByRole('button', { name: /Power at Data Center Campus/ }).click()
  const box = (await page.locator('.power-card').boundingBox())!
  const vw = page.viewportSize()!.width
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(vw)
})

test('puts the panels in a sheet that opens and closes', async ({ page }) => {
  await page.goto('/?seed=7')
  await sign(page)

  // Collapsed by default: the player lands on the map, not a wall of panels.
  await expect(page.locator('.sheet-body')).toBeHidden()

  await page.getByRole('tab', { name: /Build/ }).click()
  await expect(page.locator('.sheet-body')).toBeVisible()
  await expect(page.getByRole('button', { name: /Gas combustion turbine/ })).toBeVisible()

  await page.getByRole('tab', { name: /Build/ }).click()
  await expect(page.locator('.sheet-body')).toBeHidden()
})

test('switches between panels by tab', async ({ page }) => {
  await page.goto('/?seed=7')
  await sign(page)

  await page.getByRole('tab', { name: /Grid/ }).click()
  await expect(page.getByRole('heading', { name: 'Lines' })).toBeVisible()

  await page.getByRole('tab', { name: /Customers/ }).click()
  await expect(page.getByRole('heading', { name: 'You supply' })).toBeVisible()
  await expect(page.getByRole('tab', { name: /Deal/ })).toHaveCount(0)

  await page.getByRole('tab', { name: /Log/ }).click()
  await expect(page.locator('.log')).toBeVisible()
})

test('keeps the guide out of the way until opened', async ({ page }) => {
  await page.goto('/?seed=7')
  await sign(page)
  const coach = page.locator('.coach')
  const small = (await coach.boundingBox())!
  expect(small.height).toBeLessThan(80)
  await page.getByRole('button', { name: 'Expand the guide' }).click()
  expect((await coach.boundingBox())!.height).toBeGreaterThan(small.height)
})

test('has thumb-sized controls', async ({ page }) => {
  await page.goto('/?seed=7')
  await sign(page)
  await page.getByRole('tab', { name: /Build/ }).click()

  const tooSmall = await page.evaluate(() => {
    const els = [...document.querySelectorAll('button, [role=tab]')]
    return els
      .map((e) => ({ cls: e.className, r: e.getBoundingClientRect() }))
      .filter((x) => x.r.width > 0 && x.r.height > 0 && x.r.height < 30)
      .map((x) => `${x.cls}: ${Math.round(x.r.width)}x${Math.round(x.r.height)}`)
  })
  expect(tooSmall).toEqual([])
})

test('can site a plant by tapping the map', { tag: '@smoke' }, async ({ page }) => {
  await page.goto('/?seed=7')
  await sign(page)

  await page.getByRole('tab', { name: /Build/ }).click()
  await page.getByRole('button', { name: /Gas combustion turbine/ }).click()
  // Selecting a plant collapses nothing, so close the sheet to reach the map.
  await page.getByRole('tab', { name: /Build/ }).click()

  const box = (await page.locator('canvas.map-canvas').boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.4)

  await page.getByRole('tab', { name: /Build/ }).click()
  await expect(page.locator('.sited')).toHaveCount(1)
})

test('shows modals full-screen', async ({ page }) => {
  await page.goto('/?seed=7')
  const briefing = page.locator('dialog.briefing')
  await expect(briefing).toBeVisible()

  const vw = page.viewportSize()!.width
  const box = (await briefing.boundingBox())!
  expect(box.width).toBeGreaterThan(vw * 0.95)
  await expect(briefing).toContainText('have signed for')
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeVisible()
})
