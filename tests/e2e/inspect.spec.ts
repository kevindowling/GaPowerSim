import { test, expect, type Page } from '@playwright/test'
import { start, tab, clickAt, sitePlants, drawRoute, energize, breakAsset, endQuarter, answer, state, PLANT, CAMPUS } from './helpers.ts'

const card = (page: Page) => page.locator('.inspector')

async function siteSolar(page: Page): Promise<void> {
  await tab(page, 'Build')
  await page.getByRole('button', { name: /Utility-scale solar/ }).click()
  await clickAt(page, ...PLANT)
  await expect(page.locator('.sited')).toHaveCount(1)
}

test('clicking a solar farm shows its status', async ({ page }) => {
  await start(page)
  await siteSolar(page)
  await page.keyboard.press('Escape')
  await expect(card(page)).toHaveCount(0)

  await clickAt(page, ...PLANT)
  await expect(card(page)).toContainText('Solar farm 1')
  await expect(card(page)).toContainText('Permitting')
  await expect(card(page)).toContainText('2 quarters of permitting left')
  await expect(card(page)).toContainText('Online 2028 Q2 if nothing slips')
  await expect(card(page)).toContainText('16 MW of 200 MW')
  await expect(card(page)).toContainText('No line to the campus yet')
  await page.screenshot({ path: 'tests/.artifacts/inspect-solar.png' })
})

test('any part of its land opens it', async ({ page }) => {
  await start(page)
  await siteSolar(page)
  await page.keyboard.press('Escape')
  const b = (await page.locator('canvas.map-canvas').boundingBox())!
  // One grid cell east of the marker.
  await clickAt(page, PLANT[0] + 26 / b.width, PLANT[1])
  await expect(card(page)).toContainText('Solar farm 1')
})

test('the status moves with the project', async ({ page }) => {
  await start(page)
  await siteSolar(page)
  await clickAt(page, ...PLANT)
  for (let i = 0; i < 4; i++) {
    await endQuarter(page)
    while (await answer(page)) await page.waitForTimeout(50)
    if ((await state(page)).plants[0].status === 'construction') break
  }
  await expect(card(page)).toContainText('Under construction')
  await expect(card(page).getByRole('button', { name: /Expedite/ })).toBeVisible()
})

test('a plant can be withdrawn or connected from its card', async ({ page }) => {
  await start(page)
  await siteSolar(page)
  await clickAt(page, ...PLANT)
  await card(page).getByRole('button', { name: 'Plan a line from here' }).click()
  await expect(page.locator('.planner')).toContainText('From Solar farm 1')
  await clickAt(page, ...CAMPUS)
  await expect(page.locator('.plan')).toBeVisible()
  await page.getByRole('button', { name: 'Cancel the line' }).click()
  await clickAt(page, ...PLANT)
  await card(page).getByRole('button', { name: /Withdraw/ }).click()
  await expect(card(page)).toHaveCount(0)
  expect((await state(page)).plants).toHaveLength(0)
})

test('the campus and lines open too', async ({ page }) => {
  await start(page)
  await sitePlants(page, 3)
  await drawRoute(page)
  await page.getByRole('button', { name: 'File this route' }).click()
  await clickAt(page, ...CAMPUS)
  await expect(card(page)).toContainText('Liberty Americus Campus')
  await page.evaluate(() => {
    const s = (window as any).__game.getState()
    const c = s.game.corridors[0].centerline
    const i = c.length >> 1
    s.clickMap((c[i - 1][0] + c[i][0]) / 2, (c[i - 1][1] + c[i][1]) / 2, -1, 24)
  })
  await expect(card(page)).toContainText('Buying land')
  await expect(card(page)).toContainText('Offer by group')
})

test('a shared site lists every unit, and an outage', async ({ page }) => {
  await energize(page, '230d')
  await breakAsset(page, 'plant')
  await clickAt(page, ...PLANT)
  await expect(card(page).locator('.unit')).toHaveCount(3)
  await expect(card(page)).toContainText('Out of service')
  await expect(card(page)).toContainText('The campus already gets its 400 MW')
})

test('a plant in the list can be found on the map', async ({ page }) => {
  await start(page)
  await siteSolar(page)
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Solar farm 1' }).click()
  await expect(card(page)).toContainText('Solar farm 1')
  await page.getByRole('button', { name: 'Close' }).click()
  await expect(card(page)).toHaveCount(0)
})

for (const [name, spot] of [['right', PLANT], ['left', [0.16, 0.8]], ['bottom', [0.6, 0.93]], ['top', [0.75, 0.1]]] as const) {
  test(`details open beside the click, near the ${name} of the map`, async ({ page }) => {
    await start(page)
    const b = (await page.locator('canvas.map-canvas').boundingBox())!
    const at = { x: b.x + b.width * spot[0]!, y: b.y + b.height * spot[1]! }
    await clickAt(page, spot[0]!, spot[1]!)
    const c = (await page.locator('.map-popover').boundingBox())!
    const dx = Math.max(c.x - at.x, at.x - (c.x + c.width), 0)
    const dy = Math.max(c.y - at.y, at.y - (c.y + c.height), 0)
    expect(Math.hypot(dx, dy)).toBeLessThan(45)
    expect(Math.hypot(dx, dy)).toBeGreaterThan(10)
    expect(c.x).toBeGreaterThanOrEqual(b.x)
    expect(c.x + c.width).toBeLessThanOrEqual(b.x + b.width)
    expect(c.y).toBeGreaterThanOrEqual(b.y)
    expect(c.y + c.height).toBeLessThanOrEqual(b.y + b.height)
  })
}

test('details follow the map, and leave the panel alone', async ({ page }) => {
  await start(page)
  await sitePlants(page, 1)
  await clickAt(page, ...PLANT)
  const pop = page.locator('.map-popover')
  await expect(page.getByRole('heading', { name: 'Generation', exact: true })).toBeVisible()
  const before = (await pop.boundingBox())!
  const b = (await page.locator('canvas.map-canvas').boundingBox())!
  await page.mouse.move(b.x + b.width * 0.3, b.y + b.height * 0.3)
  await page.mouse.down()
  await page.mouse.move(b.x + b.width * 0.3 - 120, b.y + b.height * 0.3, { steps: 5 })
  await page.mouse.up()
  await page.waitForTimeout(150)
  const after = (await pop.boundingBox())!
  expect(after.x - before.x).toBeCloseTo(-120, -1)
})

test('every button in a tall card can be reached', async ({ page }) => {
  await start(page)
  await clickAt(page, 0.72, 0.75)
  const buttons = page.locator('.map-popover .programme:enabled')
  expect(await buttons.count()).toBeGreaterThan(1)
  await buttons.last().click()
  expect((await state(page)).contract.approval).toBeGreaterThan(62)
})
