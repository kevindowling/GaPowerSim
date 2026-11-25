import { test, expect, type Page } from '@playwright/test'
import { start, tab, clickAt, endQuarter } from './helpers.ts'

const card = (page: Page) => page.locator('.map-popover')

async function openSail(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as any).__game.getState().game.substations?.length > 5)
  await tab(page, 'Customers')
  await page.getByRole('button', { name: /Project Sail/ }).click()
  await page.waitForTimeout(1100)
}

test('another data center can be signed, and shares the budget and the spare power', async ({ page }) => {
  await start(page, false)
  await openSail(page)
  await expect(page.locator('.hud')).toContainText('Project Sail')
  await expect(page.locator('.hud')).toContainText('of 900 MW')
  await expect(page.locator('.hud')).toContainText('Not signed')
  await expect(card(page)).toContainText('If you supply it')
  await expect(card(page)).toContainText('5 of 180 MW')
  await page.screenshot({ path: 'tests/.artifacts/offer.png' })
  await card(page).getByRole('button', { name: /^Sign Project Sail/ }).click()
  await expect(card(page)).toContainText('No line reaches it')
  await expect(card(page)).toContainText('Contracted')
  await card(page).getByLabel('Spare power set aside').fill('900')
  await expect(page.getByRole('button', { name: /Spare power on the grid/ })).toContainText('1,833')
  await page.screenshot({ path: 'tests/.artifacts/customercard.png' })

  await page.getByRole('button', { name: /^Cash/ }).click()
  const money = page.locator('.power-card')
  await expect(money).toContainText('By data center')
  await expect(money.getByRole('row', { name: /Project Sail/ })).toContainText('$243M')
  await expect(money.getByRole('row', { name: /^Total/ })).toContainText('$531M')
  await page.screenshot({ path: 'tests/.artifacts/budget.png' })
  await page.keyboard.press('Escape')
  await expect(page.locator('.panel .line').nth(1)).toContainText('Project Sail')

  await card(page).getByRole('button', { name: 'Plan a line from here' }).click()
  await expect(page.locator('.planner')).toContainText('From Project Sail')
})

test('clicking a data center turns the header and panels to it', async ({ page }) => {
  await start(page, false)
  await openSail(page)
  await card(page).getByRole('button', { name: /^Sign Project Sail/ }).click()
  await expect(page.locator('.hud')).toContainText('0 of 5 phases on')
  await expect(page.locator('.hud')).toContainText('of 900 MW')
  await expect(card(page)).toContainText('Phases and payments')
  await expect(card(page)).toContainText('Its money')
  await tab(page, 'Build')
  await expect(page.locator('.panel')).toContainText('Project Sail needs 900 MW')
  await page.getByRole('button', { name: /Power at Data Center Campus/ }).click()
  await expect(page.locator('.power-card')).toContainText('Power at Project Sail')
  await page.screenshot({ path: 'tests/.artifacts/focus.png' })
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: /^Data center Project Sail/ }).click()
  await page.getByRole('button', { name: /Liberty Americus Campus/ }).click()
  await expect(page.locator('.hud')).toContainText('of 400 MW')
  await expect(page.locator('.panel')).toContainText('Liberty Americus Campus needs 400 MW')
  await page.waitForTimeout(1000)
  await expect(card(page)).toContainText('Phases and payments')
})

test('a substation can be built', async ({ page }) => {
  await start(page, false)
  await tab(page, 'Build')
  await page.getByRole('button', { name: /New 230 kV substation/ }).click()
  const b = (await page.locator('canvas.map-canvas').boundingBox())!
  await page.mouse.move(b.x + b.width * 0.8, b.y + b.height * 0.62, { steps: 4 })
  await expect(page.locator('.map-tip')).toContainText('In service 2027 Q4')
  await clickAt(page, 0.8, 0.62)
  await expect(page.locator('.sited')).toContainText('New 230 kV substation 1')
  await clickAt(page, 0.8, 0.62)
  await expect(page.locator('.inspector')).toContainText('Transformers here')
  await page.locator('.inspector').getByRole('button', { name: /Order, \$15\.6M/ }).click()
  await page.screenshot({ path: 'tests/.artifacts/newsub.png' })
  await endQuarter(page)
  await expect(page.locator('.sited')).toContainText('5 quarters left')
})
