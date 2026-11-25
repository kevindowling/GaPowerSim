import { test, expect } from '@playwright/test'
import { start, tab } from './helpers.ts'

test('air and water layers colour the map and answer at the pointer', async ({ page }) => {
  await start(page)
  await page.waitForFunction(() => (window as any).__game.getState().env !== null)
  const b = (await page.locator('canvas.map-canvas').boundingBox())!
  await page.getByRole('button', { name: 'Layers' }).click()
  await page.getByRole('button', { name: 'Air', exact: true }).click()
  await page.mouse.move(b.x + b.width * 0.72, b.y + b.height * 0.78, { steps: 4 })
  await expect(page.locator('.map-tip')).toContainText('Fine particles 9.3')
  await page.screenshot({ path: 'tests/.artifacts/air.png' })
  await page.getByRole('button', { name: 'Water', exact: true }).click()
  await page.mouse.move(b.x + b.width * 0.7, b.y + b.height * 0.8, { steps: 4 })
  await expect(page.locator('.map-tip')).toContainText('82% of assessed stream miles impaired')
  await page.screenshot({ path: 'tests/.artifacts/water.png' })
})

test('projections show before a plant is placed', async ({ page }) => {
  await start(page)
  await page.waitForFunction(() => (window as any).__game.getState().env !== null)
  await tab(page, 'Build')
  await page.getByRole('button', { name: /Gas combustion turbine/ }).click()
  await expect(page.locator('.plant-more')).toContainText('tons of nitrogen oxides')
  const b = (await page.locator('canvas.map-canvas').boundingBox())!
  await page.mouse.move(b.x + b.width * 0.8, b.y + b.height * 0.62, { steps: 4 })
  const tip = page.locator('.map-tip')
  await expect(tip).toContainText('Air: fine particles up')
  await expect(tip).toContainText('Ozone up')
  await expect(tip).toContainText('Water:')
  await page.screenshot({ path: 'tests/.artifacts/projection.png' })
})
