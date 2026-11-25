import { test, expect } from '@playwright/test'
import { start, tab, endQuarter } from './helpers.ts'

test('the game opens as Georgia Power, with customers that pay', { tag: '@smoke' }, async ({ page }) => {
  await page.goto('/?seed=7')
  await expect(page.locator('dialog.briefing')).toContainText('Georgia Power, August 2026')
  await expect(page.locator('dialog.briefing')).toContainText('have signed for')
  await start(page, false, true)
  await expect(page.locator('.hud')).toContainText('$2.51B')
  await tab(page, 'Customers')
  await expect(page.locator('.panel')).toContainText('QTS Fayetteville')
  await endQuarter(page)
  await page.getByRole('button', { name: /^Cash/ }).click()
  const card = page.locator('.power-card')
  await expect(card.getByRole('row', { name: /Hampton Technology Park/ })).toBeVisible()
  await expect(card.getByRole('row', { name: /QTS Fayetteville/ })).toBeVisible()
  await expect(card.getByRole('row', { name: /Starting budget/ })).toContainText('$1.00B')
  await page.screenshot({ path: 'tests/.artifacts/company.png' })
})

test('Liberty is signed from its card', async ({ page }) => {
  await start(page, false, true)
  await tab(page, 'Customers')
  await page.locator('.panel').getByRole('button', { name: 'Liberty Americus Campus' }).click()
  await expect(page.locator('.hud')).toContainText('Not signed')
  const card = page.locator('.inspector')
  await expect(card).toContainText('Paid on signing')
  await card.getByRole('button', { name: 'Sign Liberty Americus Campus' }).click()
  await expect(card).toContainText('Phases and payments')
  await expect(page.locator('.hud')).toContainText('$2.80B')
})

test('contracts are icons on the map, and more come up', async ({ page }) => {
  await start(page, false, true)
  await page.waitForTimeout(800)
  await page.screenshot({ path: 'tests/.artifacts/contracts.png' })
  await tab(page, 'Customers')
  await expect(page.locator('.panel')).toContainText('Contracts you can sign')
  const offer = await page.evaluate(() => {
    const g = (window as any).__game.getState().game
    return g.offers.find((o: any) => o.opens === g.quarter).name
  })
  await page.locator('.panel').getByRole('button', { name: offer }).first().click()
  await page.waitForTimeout(1200)
  const card = page.locator('.inspector')
  await expect(card).toContainText(offer)
  await card.getByRole('button', { name: /^Sign / }).click()
  await expect(card).toContainText('Phases and payments')
  await page.screenshot({ path: 'tests/.artifacts/contract-signed.png' })
  const shown = await page.evaluate(() => (window as any).__game.getState().game.customers.length)
  expect(shown).toBeGreaterThan(22)
})

test('a contract icon opens its card with data centers hidden', async ({ page }) => {
  await start(page, false, true)
  await page.evaluate(() => (window as any).__game.getState().setShowCenters(false))
  const hit = await page.evaluate(() => {
    const s = (window as any).__game.getState()
    const c = s.game.customers[0]
    s.clickMap(c.x, c.y, c.cell, 20)
    return { id: c.id, selection: (window as any).__game.getState().selection }
  })
  expect(hit.selection).toEqual({ kind: 'dc', id: hit.id })
})

test('a reload keeps a signed contract in the header', async ({ page }) => {
  await start(page, false, true)
  await endQuarter(page)
  await page.reload()
  await expect(page.locator('.hud')).toContainText('phases on')
})

test('a data center in the cash list opens it on the map', { tag: '@smoke' }, async ({ page }) => {
  await start(page, false, true)
  await page.getByRole('button', { name: /^Cash/ }).click()
  const card = page.locator('.power-card')
  await card.getByRole('button', { name: 'Hampton Technology Park' }).click()
  await expect(card).toHaveCount(0)
  await expect(page.locator('.hud')).toContainText('Hampton Technolog')
  await expect(page.locator('.inspector')).toContainText('Hampton Technology Park')
  await expect(page.locator('.inspector')).toContainText('Phases and payments')
  await page.waitForTimeout(1200)
  await page.screenshot({ path: 'tests/.artifacts/cash-click.png' })
})
