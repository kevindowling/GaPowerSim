import { test, expect, type Page } from '@playwright/test'
import { start, clickAt, sitePlants, state, endQuarter, answer } from './helpers.ts'

const card = (page: Page) => page.locator('.inspector')
const tip = (page: Page) => page.locator('.map-tip')
const FIELD: [number, number] = [0.72, 0.75]

async function hover(page: Page, fx: number, fy: number): Promise<{ x: number; y: number }> {
  const b = (await page.locator('canvas.map-canvas').boundingBox())!
  const at = { x: b.x + b.width * fx, y: b.y + b.height * fy }
  await page.mouse.move(at.x, at.y, { steps: 4 })
  await page.waitForTimeout(150)
  return at
}

test('names the county beside the pointer', async ({ page }) => {
  await start(page)
  for (const spot of [[0.72, 0.75], [0.3, 0.3], [0.97, 0.9], [0.5, 0.97]] as const) {
    const at = await hover(page, spot[0]!, spot[1]!)
    await expect(tip(page)).toContainText('County')
    await expect(tip(page)).toContainText(/pproval|No rating/)
    const t = (await tip(page).boundingBox())!
    const dx = Math.max(t.x - at.x, at.x - (t.x + t.width), 0)
    const dy = Math.max(t.y - at.y, at.y - (t.y + t.height), 0)
    expect(Math.hypot(dx, dy)).toBeLessThan(40)
    const map = (await page.locator('canvas.map-canvas').boundingBox())!
    expect(t.x + t.width).toBeLessThanOrEqual(map.x + map.width + 1)
    expect(t.y + t.height).toBeLessThanOrEqual(map.y + map.height + 1)
  }
  await page.screenshot({ path: 'tests/.artifacts/county-tip.png' })
})

test('names plants and refusals there too', async ({ page }) => {
  await start(page)
  await sitePlants(page, 1)
  await hover(page, 0.6, 0.8)
  await hover(page, 0.8, 0.62)
  await expect(tip(page)).toContainText('Gas turbine 1')
  await page.getByRole('button', { name: /Battery storage/ }).click()
  await hover(page, 0.5, 0.5)
  await expect(tip(page)).toContainText('The campus is here')
})

test('opens a county and raises its approval', async ({ page }) => {
  await start(page)
  await clickAt(page, ...FIELD)
  await expect(card(page)).toContainText('Sumter County')
  await expect(card(page)).toContainText('62 of 100')
  await expect(card(page)).toContainText('Permits run on schedule')
  await expect(card(page)).toContainText('About the county')
  await expect(card(page).getByRole('button', { name: /Plant a tree screen/ })).toBeDisabled()

  const before = await state(page)
  await card(page).getByRole('button', { name: /Endow a community fund/ }).click()
  const after = await state(page)
  expect(before.cash - after.cash).toBe(12_000_000)
  await expect(card(page)).toContainText('71 of 100, supportive')
  await expect(card(page)).toContainText('What changed it')
  await expect(card(page).getByRole('button', { name: /Endow a community fund/ })).toContainText('Already done here')
  await page.screenshot({ path: 'tests/.artifacts/county-card.png' })
})

test('closes when the county is clicked again', async ({ page }) => {
  await start(page)
  await clickAt(page, ...FIELD)
  await expect(card(page)).toBeVisible()
  await clickAt(page, ...FIELD)
  await expect(card(page)).toHaveCount(0)
})

test('keeps the record as the game goes on', async ({ page }) => {
  await start(page)
  await sitePlants(page, 1)
  await endQuarter(page)
  while (await answer(page)) await page.waitForTimeout(50)
  await clickAt(page, ...FIELD)
  await expect(card(page)).toContainText('Gas turbine 1 sited')
  await expect(card(page)).toContainText('1 unit, 200 MW')
})

test('the map can be coloured by approval', async ({ page }) => {
  await start(page)
  await page.getByRole('button', { name: 'Layers' }).click()
  await page.getByRole('button', { name: 'Approval', exact: true }).click()
  await expect(page.locator('.layers')).toContainText('Green is supportive')
})

test('a bordering county has its own rating', async ({ page }) => {
  await start(page)
  await page.evaluate(() => (window as any).__game.getState().select({ kind: 'county', fips: '13177' }, [0, 0]))
  await expect(card(page)).toContainText('57 of 100')
  await expect(card(page)).toContainText('it can lower the data center')
  await card(page).getByRole('button', { name: /Endow a community fund/ }).click()
  const g = await state(page)
  expect(g.counties['13177'].approval).toBe(66)
  expect(g.contract.approval).toBe(62)
})

test('data center approval opens under its number', async ({ page }) => {
  await start(page)
  const stat = page.getByRole('button', { name: /Data center approval/ })
  await expect(stat).toContainText('62')
  await stat.click()
  const pop = page.locator('.power-card')
  await expect(pop).toContainText('Below 25 when a quarter ends, the data center is cancelled')
  await expect(pop).toContainText('$672M of funding is never paid')
  await expect(pop).toContainText('Lee County')
  await pop.getByRole('button', { name: /Endow a community fund/ }).click()
  await expect(stat).toContainText('71')
  const box = (await pop.boundingBox())!
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width)
  await page.screenshot({ path: 'tests/.artifacts/approval.png' })
})

test('the data center is cancelled when approval is too low', async ({ page }) => {
  await start(page)
  await page.evaluate(() => {
    const store = (window as any).__game
    const game = structuredClone(store.getState().game)
    game.contract.approval = 20
    store.setState({ game })
  })
  await expect(page.getByRole('button', { name: /Data center approval/ })).toContainText('Cancelled below 25')
  await endQuarter(page)
  await expect(page.locator('dialog.score')).toContainText('was cancelled')
  await expect(page.locator('dialog.score')).toContainText('Never paid')
})

test('a county away from the data center has no rating', async ({ page }) => {
  await start(page)
  await page.evaluate(() => (window as any).__game.getState().select({ kind: 'county', fips: '13039' }, [0, 0]))
  await expect(card(page)).toContainText('Camden County')
  await expect(card(page)).toContainText('so it has no rating')
  await expect(card(page)).not.toContainText('Raise approval')
  await expect(card(page)).toContainText('About the county')
})

test('labels power at the campus', async ({ page }) => {
  await start(page)
  await expect(page.locator('.hud')).toContainText('Power at Data Center Campus')
})
