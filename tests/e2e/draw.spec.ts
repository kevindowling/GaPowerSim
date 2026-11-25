import { test, expect, type Page } from '@playwright/test'
import { start, sitePlants, tab, clickAt, state, PLANT, CAMPUS } from './helpers.ts'

const banner = (page: Page) => page.locator('.map-banner')
const planner = (page: Page) => page.locator('.map-popover .planner')
const canvas = (page: Page) => page.locator('canvas.map-canvas')
const plan = (page: Page) => page.evaluate(() => {
  const p = (window as any).__game.getState().plan
  return p && { from: p.from.id, to: p.to.id }
})

async function arm(page: Page): Promise<void> {
  await start(page)
  await sitePlants(page, 1)
  await tab(page, 'Grid')
  await page.getByRole('button', { name: 'Plan a line', exact: true }).click()
}

async function hover(page: Page, fx: number, fy: number): Promise<void> {
  const b = (await canvas(page).boundingBox())!
  await page.mouse.move(b.x + b.width * fx, b.y + b.height * fy, { steps: 4 })
  await page.waitForTimeout(120)
}

async function pixels(page: Page): Promise<string> {
  await page.waitForTimeout(120)
  return page.evaluate(() => (document.querySelector('canvas.map-canvas') as HTMLCanvasElement).toDataURL().slice(-60_000))
}

test('says what to do at each step, on the map', { tag: '@smoke' }, async ({ page }) => {
  await arm(page)
  await expect(banner(page)).toContainText('Click either end')
  await clickAt(page, ...PLANT)
  await expect(planner(page)).toContainText('From Gas turbine 1')
  await clickAt(page, ...CAMPUS)
  await expect(planner(page)).toContainText('Gas turbine 1 to Liberty Americus Campus')
  await planner(page).getByRole('button', { name: 'File this route' }).click()
  expect((await state(page)).corridors).toHaveLength(1)
  await expect(banner(page)).toHaveCount(0)
})

test('the pointer shows where a line can connect', async ({ page }) => {
  await arm(page)
  await hover(page, 0.9, 0.2)
  await expect(canvas(page)).not.toHaveClass(/valid/)
  await hover(page, ...PLANT)
  await expect(canvas(page)).toHaveClass(/\bvalid\b/)
  await clickAt(page, ...PLANT)
  await hover(page, 0.7, 0.58)
  await hover(page, ...PLANT)
  await expect(canvas(page)).toHaveClass(/invalid/)
  await hover(page, ...CAMPUS)
  await expect(canvas(page)).toHaveClass(/\bvalid\b/)
})

test('a line follows the pointer after the first click', async ({ page }) => {
  await arm(page)
  await clickAt(page, ...PLANT)
  await hover(page, 0.7, 0.25)
  const a = await pixels(page)
  await page.screenshot({ path: 'tests/.artifacts/draft.png' })
  await hover(page, 0.6, 0.8)
  expect(await pixels(page)).not.toBe(a)
  const label = await page.evaluate(() => {
    const s = (window as any).__game.getState()
    return s.probeRoute(s.tool.from.x + 3, s.tool.from.y + 4, 24).label
  })
  expect(label).toBe('5.0 km')
})

test('shows the route itself when over a place it can connect', async ({ page }) => {
  await arm(page)
  await clickAt(page, ...PLANT)
  const d = await page.evaluate(() => {
    const s = (window as any).__game.getState()
    const g = s.game
    const cols = s.mapData.grid.spec.cols
    void cols
    const c = g.contract.siteCell
    const row = Math.floor(c / cols)
    const spec = s.mapData.grid.spec
    const x = spec.originX + Math.sqrt(3) * 0.6204 * (c - row * cols + 0.5 * (row & 1))
    const y = spec.originY + 1.5 * 0.6204 * row
    const p = s.probeRoute(x, y, 24)
    return { state: p.state, points: p.line?.length ?? 0, label: p.label }
  })
  expect(d.state).toBe('valid')
  expect(d.points).toBeGreaterThan(3)
  expect(d.label).toMatch(/Connect to Liberty Americus Campus, [\d.]+ km/)
})

test('works from the campus to the plant', async ({ page }) => {
  await arm(page)
  await clickAt(page, ...CAMPUS)
  await expect(planner(page)).toContainText('From Liberty Americus Campus')
  await clickAt(page, ...PLANT)
  expect((await plan(page))!.from).toBe('campus')
  expect((await plan(page))!.to).toMatch(/^site:/)
})

test('works from an existing line to the plant', async ({ page }) => {
  await arm(page)
  const started = await page.evaluate(() => {
    const s = (window as any).__game.getState()
    const line = s.tappable().find((l: any) => l.kv === 230)
    const [x, y] = line.points[line.points.length >> 1]
    s.clickMap(x, y, -1, 24)
    return (window as any).__game.getState().tool.from?.id
  })
  expect(started).toMatch(/^grid:230:/)
  await clickAt(page, ...PLANT)
  expect((await plan(page))!.to).toMatch(/^site:/)
})

for (const [name, from, to] of [['plant to campus', PLANT, CAMPUS], ['campus to plant', CAMPUS, PLANT]] as const) {
  test(`can be dragged, ${name}`, async ({ page }) => {
    await arm(page)
    const b = (await canvas(page).boundingBox())!
    await page.mouse.move(b.x + b.width * from[0], b.y + b.height * from[1])
    await page.mouse.down()
    await page.mouse.move(b.x + b.width * 0.65, b.y + b.height * 0.4, { steps: 6 })
    await page.mouse.move(b.x + b.width * to[0], b.y + b.height * to[1], { steps: 6 })
    await page.mouse.up()
    await expect.poll(() => plan(page)).not.toBeNull()
    await expect(page.locator('.plan')).toBeVisible()
  })
}

test('a drag that misses keeps its start, and the map did not move', async ({ page }) => {
  await arm(page)
  const b = (await canvas(page).boundingBox())!
  await page.mouse.move(b.x + b.width * PLANT[0], b.y + b.height * PLANT[1])
  await page.mouse.down()
  await page.mouse.move(b.x + b.width * 0.75, b.y + b.height * 0.25, { steps: 6 })
  await page.mouse.up()
  await expect(planner(page)).toContainText('From Gas turbine 1')
  expect(await plan(page)).toBeNull()
  await clickAt(page, ...CAMPUS)
  expect(await plan(page)).not.toBeNull()
})

test('can be stepped back with Escape', async ({ page }) => {
  await arm(page)
  await clickAt(page, ...PLANT)
  await clickAt(page, ...CAMPUS)
  await page.keyboard.press('Escape')
  await expect(banner(page)).toContainText('Click either end')
  expect(await plan(page)).toBeNull()
  await page.keyboard.press('Escape')
  await expect(banner(page)).toHaveCount(0)
})

test('can be started from the campus card', async ({ page }) => {
  await start(page)
  await sitePlants(page, 1)
  await clickAt(page, ...CAMPUS)
  await page.locator('.inspector').getByRole('button', { name: 'Plan a line from here' }).click()
  await expect(planner(page)).toContainText('From Liberty Americus Campus')
  await clickAt(page, ...PLANT)
  expect(await plan(page)).not.toBeNull()
})

test('the kind of line and its route are chosen at the click', async ({ page }) => {
  await arm(page)
  const near = async (fx: number, fy: number) => {
    const b = (await canvas(page).boundingBox())!
    const c = (await page.locator('.map-popover').boundingBox())!
    const [x, y] = [b.x + b.width * fx, b.y + b.height * fy]
    return Math.hypot(Math.max(c.x - x, x - c.x - c.width, 0), Math.max(c.y - y, y - c.y - c.height, 0))
  }
  await clickAt(page, ...PLANT)
  await expect(planner(page).getByRole('group', { name: 'Voltage' })).toBeVisible()
  await expect(page.locator('.sidebar').getByRole('group', { name: 'Voltage' })).toHaveCount(0)
  expect(await near(...PLANT)).toBeLessThan(60)
  await planner(page).getByRole('button', { name: /500 kV/ }).click()
  await clickAt(page, ...CAMPUS)
  expect(await page.evaluate(() => (window as any).__game.getState().plan.classId)).toBe('500')
  expect(await near(...CAMPUS)).toBeLessThan(60)
  await planner(page).getByRole('button', { name: 'Shortest' }).click()
  expect(await page.evaluate(() => (window as any).__game.getState().plan.style)).not.toBe('balanced')
  await expect(page.getByTestId('plan-phases')).toContainText('of 4')
  await page.screenshot({ path: 'tests/.artifacts/planner.png' })
})

test('land offers open where the line was filed', async ({ page }) => {
  await arm(page)
  await clickAt(page, ...PLANT)
  await clickAt(page, ...CAMPUS)
  await planner(page).getByRole('button', { name: 'File this route' }).click()
  const card = page.locator('.map-popover .inspector')
  await expect(card).toContainText('Offer by group')
  await card.getByRole('button', { name: 'Send', exact: true }).first().click()
  await expect(card).toContainText('Sent')
  await page.screenshot({ path: 'tests/.artifacts/landcard.png' })
  await card.getByRole('button', { name: 'Close' }).click()
  await tab(page, 'Grid')
  await page.locator('.line-pick').first().click()
  await expect(card).toContainText('Offer by group')
})

test('from a data center, lines without room for its next phase are gray', async ({ page }) => {
  await start(page, false)
  await clickAt(page, ...CAMPUS)
  await page.locator('.inspector').getByRole('button', { name: 'Plan a line from here' }).click()
  await expect(planner(page)).toContainText('It still needs 400 MW, 100 MW of it for the next phase')
  const label = await page.evaluate(() => {
    const s = (window as any).__game.getState()
    const l = s.tappable().find((x: any) => x.kv === 115)
    const [x, y] = l.points[l.points.length >> 1]
    return s.probeRoute(x, y, 24).label
  })
  expect(label).toContain('90 MW to spare')
  await page.screenshot({ path: 'tests/.artifacts/room.png' })
})

test('the card says why a line brings nothing, and fixes it there', async ({ page }) => {
  await start(page, false, true)
  await page.getByRole('button', { name: /^Cash/ }).click()
  await page.locator('.power-card').getByRole('button', { name: /Microsoft Douglasville/ }).click()
  await page.waitForTimeout(1100)
  await page.getByRole('button', { name: 'Plan a line from here' }).click()
  await page.evaluate(() => {
    const s = (window as any).__game.getState()
    const f = s.tool.from
    const [sub] = s.game.substations.filter((x: any) => x.kv === 230).sort((a: any, b: any) => Math.hypot(a.x - f.x, a.y - f.y) - Math.hypot(b.x - f.x, b.y - f.y))
    s.clickMap(sub.x, sub.y, -1, 24)
  })
  await expect(page.getByTestId('plan-power')).toHaveText('0 MW of 216 MW')
  await expect(page.getByTestId('plan-why')).toHaveCount(0)
  await page.screenshot({ path: 'tests/.artifacts/why.png' })
  await planner(page).getByRole('button', { name: /^Build, \$13\.4M/ }).click()
  await page.screenshot({ path: 'tests/.artifacts/gear-ordered.png' })
  await expect(page.getByTestId('plan-power')).toHaveText('216 MW of 216 MW, up from 0 MW')
  await expect(page.getByTestId('plan-phases')).toHaveText('2 of 2')
  await planner(page).getByLabel('Spare power set aside').fill('108')
  await expect(page.getByTestId('plan-phases')).toHaveText('1 of 2')
  // Nothing is set aside until the line is filed.
  await expect(page.locator('.hud')).toContainText('2,733 MW left')
  await planner(page).getByRole('button', { name: 'File this route' }).click()
  await expect(page.locator('.hud')).toContainText('2,625 MW left')
})

test('the card says when a phase is too big for the line', async ({ page }) => {
  await start(page, false, true)
  await page.getByRole('button', { name: /^Cash/ }).click()
  await page.locator('.power-card').getByRole('button', { name: /Hampton/ }).click()
  await page.waitForTimeout(1100)
  await page.getByRole('button', { name: 'Plan a line from here' }).click()
  await page.evaluate(() => {
    const s = (window as any).__game.getState()
    const f = s.tool.from
    const [sub] = s.game.substations.filter((x: any) => x.kv === 230).sort((a: any, b: any) => Math.hypot(a.x - f.x, a.y - f.y) - Math.hypot(b.x - f.x, b.y - f.y))
    s.clickMap(sub.x, sub.y, -1, 24)
  })
  await expect(page.getByTestId('plan-why')).toContainText('The most this can bring is 240 MW, and a phase takes 300 MW')
})

test('a missing transformer is marked on the line, and the mark builds it', { tag: '@smoke' }, async ({ page }) => {
  await start(page, false)
  await sitePlants(page, 1)
  await tab(page, 'Grid')
  await page.getByRole('button', { name: 'Plan a line', exact: true }).click()
  await clickAt(page, ...PLANT)
  await clickAt(page, ...CAMPUS)
  await page.screenshot({ path: 'tests/.artifacts/gear-missing.png' })
  await expect(planner(page)).not.toContainText('has no')
  await planner(page).getByRole('button', { name: 'File this route' }).click()
  const before = await pixels(page)
  // 42 pixels along the line from the campus.
  await page.evaluate(() => {
    const s = (window as any).__game.getState()
    s.select(null)
    const line = [...s.game.corridors[0].centerline].reverse()
    let left = 42 / 24
    for (let i = 1; i < line.length; i++) {
      const d = Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1])
      if (d >= left) {
        const k = left / d
        s.clickMap(line[i - 1][0] + (line[i][0] - line[i - 1][0]) * k, line[i - 1][1] + (line[i][1] - line[i - 1][1]) * k, -1, 24)
        return
      }
      left -= d
    }
  })
  const card = page.locator('.gear-card')
  await expect(card).toContainText('230 kV transformer')
  await page.screenshot({ path: 'tests/.artifacts/gear-card.png' })
  await card.getByRole('button', { name: 'Build, $13.4M, 10 quarters' }).click()
  await expect(card).toContainText('Being built, in service')
  expect((await state(page)).equipment).toHaveLength(1)
  await page.evaluate(() => (window as any).__game.getState().select(null))
  await page.waitForTimeout(200)
  expect(await pixels(page)).not.toBe(before)
})

test('clicking the mark while drawing opens the build card, and does not bend the line', async ({ page }) => {
  await start(page, false)
  await sitePlants(page, 1)
  await tab(page, 'Grid')
  await page.getByRole('button', { name: 'Plan a line', exact: true }).click()
  await clickAt(page, ...PLANT)
  await clickAt(page, ...CAMPUS)
  const b = (await canvas(page).boundingBox())!
  const at = await page.evaluate(() => {
    const s = (window as any).__game.getState()
    const line = [...s.plan.centerline].reverse()
    let left = 42 / 24
    for (let i = 1; i < line.length; i++) {
      const d = Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1])
      if (d >= left) {
        const k = left / d
        return [(line[i - 1][0] + (line[i][0] - line[i - 1][0]) * k - line[0][0]) * 24, (line[i - 1][1] + (line[i][1] - line[i - 1][1]) * k - line[0][1]) * 24]
      }
      left -= d
    }
    return [0, 0]
  })
  const [x, y] = [b.x + b.width * 0.5 + at[0], b.y + b.height * 0.5 - at[1]]
  await page.mouse.move(x, y)
  await page.waitForTimeout(150)
  await expect(canvas(page)).toHaveClass(/\bvalid\b/)
  await page.mouse.click(x, y)
  const card = page.locator('.gear-card')
  await card.getByRole('button', { name: /Build from stock/ }).click()
  await expect(card).toContainText('Being built')
  await card.getByRole('button', { name: 'Close' }).click()
  await expect(planner(page)).toBeVisible()
  expect(await page.evaluate(() => (window as any).__game.getState().plan.waypoints.length)).toBe(0)
  await planner(page).getByRole('button', { name: 'File this route' }).click()
  await expect(page.locator('.map-popover')).toContainText('Being built')
})

test('a filed line offers to build its transformer', async ({ page }) => {
  await start(page, false)
  await sitePlants(page, 1)
  await tab(page, 'Grid')
  await page.getByRole('button', { name: 'Plan a line', exact: true }).click()
  await clickAt(page, ...PLANT)
  await clickAt(page, ...CAMPUS)
  await planner(page).getByRole('button', { name: 'File this route' }).click()
  const card = page.locator('.map-popover .inspector')
  await expect(card).toContainText('Offer by group')
  await card.getByRole('button', { name: /^Build, \$13\.4M/ }).click()
  await expect(card).toContainText('Being built, in service')
})
