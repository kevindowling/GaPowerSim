import { test, expect } from '@playwright/test'
import { start, tab } from './helpers.ts'

test('every reported data center is listed, and opens on the map', async ({ page }) => {
  await start(page)
  await tab(page, 'Customers')
  const panel = page.locator('.panel')
  await expect(panel).toContainText('3,210 MW')
  const all = await panel.locator('.line').count()
  expect(all).toBeGreaterThan(60)
  await page.getByRole('button', { name: 'Georgia Power', exact: true }).click()
  expect(await panel.locator('.line').count()).toBeLessThan(all)
  await page.getByRole('button', { name: 'AL and MS' }).click()
  await expect(panel).toContainText('Project Marvel')
  await page.getByRole('button', { name: 'All', exact: true }).click()
  await panel.getByRole('button', { name: /Project Camellia/ }).click()
  const card = page.locator('.map-popover')
  await expect(card).toContainText('3,210 MW')
  await expect(card).toContainText('Effingham')
  expect(await card.locator('a').count()).toBeGreaterThan(0)
  await page.waitForTimeout(1100)
  await page.screenshot({ path: 'tests/.artifacts/customer.png' })
})

test('data centers can be hidden', async ({ page }) => {
  await start(page)
  expect(await page.evaluate(() => (window as any).__game.getState().shownCenters().length)).toBeGreaterThan(90)
  await page.getByRole('button', { name: 'Layers' }).click()
  await page.getByLabel('Data centers').uncheck()
  expect(await page.evaluate(() => (window as any).__game.getState().shownCenters().length)).toBe(0)
})

test('spare power on the grid is in the header', async ({ page }) => {
  await start(page)
  const stat = page.getByRole('button', { name: /Spare power on the grid/ })
  await expect(stat).toContainText('2,733')
  await stat.click()
  const card = page.locator('.power-card')
  await expect(card).toContainText('2,733 MW left to share out')
  await expect(card).toContainText('1,739 MW above the reserve target')
  await expect(card.getByRole('row', { name: '2029 -119 MW -1,764 MW' })).toBeVisible()
  await expect(card).toContainText('16,100 MW')
  await page.screenshot({ path: 'tests/.artifacts/spare.png' })
})
