import { test, expect } from '@playwright/test'
import { start, tab, clickAt, sitePlants, endQuarter, state } from './helpers.ts'

test('opens as the company, and Liberty shows its terms and sources before it is signed', async ({ page }) => {
  await page.goto('/?seed=7')
  const d = page.locator('dialog.briefing')
  await expect(d).toContainText('The game ends in 2034 Q4')
  await expect(d).toContainText('invented')
  await expect(d).not.toContainText('Liberty')
  await expect(page.locator('.hud')).toContainText('$2.51B')
  await d.getByRole('button', { name: 'Start', exact: true }).click()
  await tab(page, 'Customers')
  await page.locator('.panel').getByRole('button', { name: 'Liberty Americus Campus' }).click()
  const card = page.locator('.inspector')
  await expect(card).toContainText('400 MW')
  await expect(card).toContainText('Sign by2028 Q3, 8 quarters left')
  await expect(card).not.toContainText('Late payments')
  await expect(card.locator('.sources a').first()).toHaveAttribute('href', /americustimesrecorder\.com/)
})

test('signing pays the first milestone', async ({ page }) => {
  await start(page)
  await expect(page.locator('.hud')).toContainText('$288M')
})

test('sites a plant and starts its permit', async ({ page }) => {
  await start(page)
  await sitePlants(page, 1)
  await expect(page.locator('.sited')).toContainText('Permitting')
  await expect(page.locator('.sited')).toContainText('No line to the campus yet')
  const g = await state(page)
  expect(g.contract.approval).toBeLessThan(62)
})

test('says why a site is refused', async ({ page }) => {
  await start(page)
  await page.getByRole('button', { name: /Battery storage/ }).click()
  await clickAt(page, 0.5, 0.5)
  await expect(page.locator('.map-tip')).toContainText('The campus is here')
  expect((await state(page)).plants).toHaveLength(0)
})

test('withdraws a plant and returns part of the land cost', async ({ page }) => {
  await start(page)
  await sitePlants(page, 1)
  const before = await state(page)
  await page.locator('.sidebar').getByRole('button', { name: /Withdraw/ }).click()
  const after = await state(page)
  expect(after.plants).toHaveLength(0)
  expect(after.cash).toBeGreaterThan(before.cash)
  expect(after.cash).toBeLessThan(before.cash + before.plants[0].landCost)
})

test('ends quarters without a dialog for every one', { tag: '@smoke' }, async ({ page }) => {
  await start(page)
  await endQuarter(page)
  await expect(page.locator('.hud')).toContainText('2026 Q4')
})

test('groups units on one site', async ({ page }) => {
  await start(page)
  await sitePlants(page, 3)
  const cells = new Set((await state(page)).plants.map((p: { cell: number }) => p.cell))
  expect(cells.size).toBe(1)
})

test('keeps the game across a reload', { tag: '@smoke' }, async ({ page }) => {
  await start(page)
  await sitePlants(page, 2)
  await page.reload()
  await expect(page.locator('dialog.briefing')).toHaveCount(0)
  await expect(page.locator('.sited')).toHaveCount(2)
})

test('the menu starts a new game without a choice of contract', { tag: '@smoke' }, async ({ page }) => {
  await start(page)
  await sitePlants(page, 1)
  await page.getByRole('button', { name: 'Menu' }).click()
  const menu = page.locator('dialog.menu')
  await expect(menu).not.toContainText(/Dublin|Americus/)
  await menu.getByRole('button', { name: 'New game' }).click()
  await expect(page.locator('dialog.briefing')).toContainText('Georgia Power, August 2026')
  await page.getByRole('button', { name: 'Start', exact: true }).click()
  await expect(page.locator('.hud')).toContainText('$2.51B')
  expect((await state(page)).plants.length).toBe(0)
})

test('explains the map layers', async ({ page }) => {
  await start(page)
  await page.getByRole('button', { name: 'Layers' }).click()
  await page.getByRole('button', { name: 'Land value' }).click()
  await expect(page.locator('.layers')).toContainText('right-of-way cost')
  await expect(page.locator('.ramp-landValue')).toBeVisible()
})
