import { test, expect, type Page } from '@playwright/test'
import { start, tab, clickAt, sitePlants, drawRoute, endQuarter, PLANT } from './helpers.ts'

const stat = (page: Page) => page.getByRole('button', { name: /Power at Data Center Campus/ })
const power = (page: Page) => page.locator('.power-card')

test('the forecast opens under the number it explains', async ({ page }) => {
  await start(page)
  await stat(page).click()
  await expect(power(page)).toContainText('Nothing filed')
  const s = (await stat(page).boundingBox())!
  const c = (await power(page).boundingBox())!
  expect(c.y - (s.y + s.height)).toBeLessThan(24)
  expect(Math.abs(c.x - s.x)).toBeLessThan(40)
  await page.keyboard.press('Escape')
  await expect(power(page)).toHaveCount(0)
})

test('a finished solar farm says why nothing arrives', async ({ page }) => {
  await start(page)
  await tab(page, 'Build')
  await page.getByRole('button', { name: /Utility-scale solar/ }).click()
  await clickAt(page, ...PLANT)
  await page.evaluate(() => {
    const store = (window as any).__game
    const game = structuredClone(store.getState().game)
    game.plants[0].status = 'online'
    game.plants[0].quartersRemaining = 0
    store.setState({ game })
  })
  await expect(stat(page)).toContainText('16 MW has no line')
  await clickAt(page, ...PLANT)
  const card = page.locator('.inspector')
  await expect(card).toContainText('16 MW of 200 MW')
  await expect(card).toContainText('Reaching the campus')
  await expect(card).toContainText('No line to the campus yet')
  await expect(card).toContainText('Solar makes nothing at night')
})

test('shows what arrives quarter by quarter', async ({ page }) => {
  await start(page)
  await sitePlants(page, 3)
  await drawRoute(page)
  await expect(page.getByTestId('plan-power')).toContainText('400 MW')
  await page.getByRole('button', { name: 'File this route' }).click()
  await expect(stat(page)).toContainText('400 MW by 2029 Q1')
  await stat(page).click()
  await expect(power(page)).toContainText('400 MW arrives in 2029 Q1')
  await expect(power(page)).toContainText('Land is assumed to take 8 quarters')
  await expect(power(page).getByRole('row', { name: /Gas turbine 1 2029 Q1 190 MW/ })).toBeVisible()
  await power(page).locator('.pc-hit').nth(11).hover()
  await expect(page.locator('.pc-tip')).toContainText('400 MW arriving')
  await power(page).getByRole('button', { name: 'Close' }).click()
  await expect(power(page)).toHaveCount(0)
  await page.screenshot({ path: 'tests/.artifacts/power.png' })
})

test('phases turn on one at a time and pay', async ({ page }) => {
  await start(page)
  await sitePlants(page, 2)
  await drawRoute(page)
  await page.getByRole('button', { name: 'File this route' }).click()
  await page.evaluate(() => {
    const store = (window as any).__game
    const game = structuredClone(store.getState().game)
    game.plants[0].status = 'online'
    game.plants[0].quartersRemaining = 0
    game.plants[1].status = 'construction'
    game.plants[1].quartersRemaining = 4
    for (const c of game.corridors) { c.status = 'energized'; c.capexSpent = c.capexTotal }
    game.hearing = 'resolved'
    game.firedEvents = ['turbine-slot', 'site-storm', 'water', 'gas-lateral', 'steel', 'tortoise', 'training', 'early-service', 'landowners', 'moratorium']
    store.setState({ game })
  })
  await stat(page).click()
  await expect(power(page).getByRole('row', { name: '100 MW 2029 Q1 2026 Q3 $168M' })).toBeVisible()
  await expect(power(page).getByRole('row', { name: '200 MW 2029 Q2 2027 Q2 $168M' })).toBeVisible()
  await expect(power(page).getByRole('row', { name: '400 MW 2029 Q4 Not planned $168M' })).toBeVisible()
  await page.keyboard.press('Escape')
  await endQuarter(page)
  await expect(page.locator('.toast')).toContainText('1 of 4 phases on, 100 MW')
  await endQuarter(page)
  await expect(page.locator('.toast')).toContainText('paid $')
  await stat(page).click()
  await expect(power(page).getByRole('row', { name: '100 MW 2029 Q1 On $168M' })).toBeVisible()
  await page.screenshot({ path: 'tests/.artifacts/phases.png' })
})

test('a data center lists each payment and when it is due', async ({ page }) => {
  await start(page)
  await clickAt(page, 0.5, 0.5)
  const card = page.locator('.inspector')
  await expect(card.getByRole('row', { name: 'Contract signed 2026 Q3 $288M' })).toBeVisible()
  await expect(card.getByRole('row', { name: '100 MW 2029 Q1 Not planned $168M' })).toBeVisible()
  await expect(card).toContainText('loses 10% for every quarter late')
  await page.evaluate(() => {
    const store = (window as any).__game
    const game = structuredClone(store.getState().game)
    game.quarter += 12
    store.setState({ game })
  })
  await expect(card.getByRole('row', { name: '100 MW 2029 Q1 Not planned $134M' })).toBeVisible()
})

test('a line needs a transformer, and one can be ordered', async ({ page }) => {
  await start(page, false)
  await sitePlants(page, 2)
  await drawRoute(page)
  await expect(page.getByTestId('plan-power')).toContainText('0 MW')
  await expect(page.locator('.plan').getByRole('button', { name: 'Build, $13.4M, 10 quarters' })).toBeVisible()
  await page.getByRole('button', { name: 'File this route' }).click()
  await stat(page).click()
  await expect(power(page)).toContainText('so 230 kV lines cannot serve it')
  await page.keyboard.press('Escape')
  await clickAt(page, 0.5, 0.5)
  const card = page.locator('.inspector')
  await expect(card).toContainText('Transformers here')
  await card.getByRole('button', { name: /Order, \$13\.4M, 10 quarters/ }).click()
  await expect(card).toContainText('420 MW in 2028 Q4')
  await expect(stat(page)).toContainText('380 MW by')
  await page.screenshot({ path: 'tests/.artifacts/transformer.png' })
  await page.keyboard.press('Escape')
  await page.evaluate(() => (window as any).__game.getState().select({ kind: 'substation' }))
  await expect(card).toContainText('North Americus Substation')
  await expect(card).toContainText('Rebuild 230 kV lines')
  await page.screenshot({ path: 'tests/.artifacts/substation.png' })
})
