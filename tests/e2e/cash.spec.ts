import { test, expect } from '@playwright/test'
import { start, sitePlants, drawRoute, endQuarter } from './helpers.ts'

test('cash by quarter opens under Cash, with what changed', async ({ page }) => {
  await start(page)
  await sitePlants(page, 3)
  await drawRoute(page)
  await page.getByRole('button', { name: 'File this route' }).click()
  await endQuarter(page)
  while (await page.locator('dialog .choice').count()) await page.locator('dialog .choice').first().click()
  await page.getByRole('button', { name: /^Cash/ }).click()
  const card = page.locator('.power-card')
  await expect(card).toContainText('Now, and your score')
  await expect(card).toContainText('Cash by quarter')
  await expect(card).toContainText('The lowest point is')
  await expect(card).toContainText('What changed in 2026 Q3')
  expect(await card.locator('.table-scroll tr').count()).toBeGreaterThan(15)
  await card.locator('.pc-hit').nth(6).hover()
  await expect(card.locator('.pc-tip')).toContainText('forecast')
  await page.screenshot({ path: 'tests/.artifacts/cash.png' })
})
