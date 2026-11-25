import { test, expect, type Page } from '@playwright/test'
import { start } from './helpers.ts'

const card = (page: Page) => page.locator('.inspector')

const ready = (page: Page) => page.waitForFunction(() => (window as any).__game.getState().game.substations?.length > 5)

test('a real substation opens, with its transformers', async ({ page }) => {
  await start(page, false)
  await ready(page)
  await page.evaluate(() => {
    const s = (window as any).__game.getState()
    const sub = s.game.substations.find((x: any) => x.kv === 230)
    s.clickMap(sub.x, sub.y, -1, 24)
  })
  await expect(card(page)).toContainText('Transformers mapped')
  await card(page).getByRole('button', { name: /Order, \$15\.6M/ }).click()
  await expect(card(page)).toContainText('420 MW in 2028 Q4')
  await page.waitForTimeout(300)
  await page.screenshot({ path: 'tests/.artifacts/gridsub.png' })
  await card(page).getByRole('button', { name: 'Plan a line from here' }).click()
  await expect(page.locator('.planner')).toContainText('From')
})

test('an existing line opens, and can start a line', async ({ page }) => {
  await start(page, false)
  await ready(page)
  await page.evaluate(() => {
    const s = (window as any).__game.getState()
    const l = s.mapThings().lines.find((x: any) => x.kv === 230 && Math.hypot(x.points[0][0] + 66, x.points[0][1] + 50) < 12)
    const i = l.points.length >> 1
    s.clickMap((l.points[i - 1][0] + l.points[i][0]) / 2, (l.points[i - 1][1] + l.points[i][1]) / 2, -1, 30)
  })
  await expect(card(page)).toContainText('Existing 230 kV line')
  await expect(card(page)).toContainText('Room to spare')
  await page.waitForTimeout(300)
  await page.screenshot({ path: 'tests/.artifacts/gridline.png' })
  await card(page).getByRole('button', { name: 'Plan a line from here' }).click()
  await expect(page.locator('.planner')).toContainText('From existing 230 kV line')
})
