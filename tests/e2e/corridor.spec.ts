import { test, expect } from '@playwright/test'
import { PLANT, start, sitePlants, drawRoute, clickAt, endQuarter, answer, state, tab } from './helpers.ts'

test('prices a route and who it affects', async ({ page }) => {
  await start(page)
  await sitePlants(page, 3)
  await drawRoute(page)
  await expect(page.locator('.plan')).toContainText('Parcels crossed')
  expect(Number(await page.getByTestId('plan-parcels').innerText())).toBeGreaterThan(10)
  await expect(page.locator('.plan')).toContainText('generated')
  await page.screenshot({ path: 'tests/.artifacts/plan.png' })
})

test('will not start a line in an empty field', async ({ page }) => {
  await start(page)
  await tab(page, 'Grid')
  await page.getByRole('button', { name: 'Plan a line', exact: true }).click()
  await clickAt(page, 0.7, 0.2)
  await expect(page.locator('.map-banner')).toContainText('a line of 115 kV or more')
  await expect(page.locator('.plan')).toHaveCount(0)
})

test('can tap an existing line', async ({ page }) => {
  await start(page)
  await sitePlants(page, 1)
  await tab(page, 'Grid')
  await page.getByRole('button', { name: 'Plan a line', exact: true }).click()
  await clickAt(page, ...PLANT)
  // The nearest existing 230 kV line to the plant.
  const ok = await page.evaluate(() => {
    const s = (window as any).__game.getState()
    const from = s.tool.from
    let best: any = null
    for (const l of s.tappable()) {
      if (l.kv < 230 || l.kv >= 500) continue
      for (const [x, y] of l.points) {
        const d = Math.hypot(x - from.x, y - from.y)
        if (!best || d < best.d) best = { x, y, d }
      }
    }
    s.clickMap(best.x, best.y, -1, 24)
    return (window as any).__game.getState().plan !== null
  })
  expect(ok).toBe(true)
  await expect(page.locator('.planner')).toContainText('existing 230 kV line')
  await expect(page.getByTestId('plan-tap')).toContainText('$22.0M, 2 quarters')
  await page.screenshot({ path: 'tests/.artifacts/tap.png' })
  await page.getByRole('button', { name: 'File this route' }).click()
  await tab(page, 'Grid')
  await expect(page.locator('.lines')).toContainText('Existing 230 kV lines')
  await expect(page.locator('.panel')).toContainText('120 MW of 400 MW firm can reach Liberty Americus Campus')
})

test('changes what is cut when the route style changes', async ({ page }) => {
  await start(page)
  await sitePlants(page, 1)
  await drawRoute(page)
  await page.getByRole('button', { name: 'Shortest' }).click()
  const direct = Number(await page.getByTestId('plan-severed').innerText())
  await page.getByRole('button', { name: 'Property lines' }).click()
  await expect.poll(async () => Number(await page.getByTestId('plan-severed').innerText())).not.toBe(direct)
})

test('bends through a clicked point and can undo it', async ({ page }) => {
  await start(page)
  await sitePlants(page, 1)
  await drawRoute(page)
  const length = () => page.evaluate(() => (window as any).__game.getState().plan.lengthKm)
  const before = await length()
  await clickAt(page, 0.62, 0.25)
  expect(await length()).toBeGreaterThan(before + 1)
  await page.getByRole('button', { name: 'Remove last bend' }).click()
  expect(await length()).toBeCloseTo(before, 3)
})

test('takes more land at a higher voltage', async ({ page }) => {
  await start(page)
  await sitePlants(page, 1)
  await drawRoute(page)
  const acres = async () => Number((await page.getByTestId('plan-acres').innerText()).replace(/\D/g, ''))
  const before = await acres()
  await page.getByRole('button', { name: /500 kV/ }).click()
  expect(await acres()).toBeGreaterThan(before)
})

test('negotiates by group, then shows only the problems', async ({ page }) => {
  await start(page)
  await sitePlants(page, 3)
  await drawRoute(page)
  await page.getByRole('button', { name: 'File this route' }).click()
  await expect(page.locator('.map-popover')).toContainText('Offer by group')
  await expect(page.locator('.parcel')).toHaveCount(0)
  const send = page.getByRole('button', { name: 'Send', exact: true })
  for (let n = await send.count(); n > 0; n--) await send.first().click()
  await endQuarter(page)
  while (await answer(page)) await page.waitForTimeout(50)
  const deals = Object.values((await state(page)).corridors[0].deals) as Array<{ status: string }>
  expect(deals.filter((d) => d.status === 'accepted').length).toBeGreaterThan(3)
  expect(await page.locator('.parcel').count()).toBe(deals.filter((d) => d.status === 'holdout').length)
  await page.locator('.parcel').first().getByRole('button', { name: /Condemn/ }).click()
  expect((await state(page)).record.condemnations).toBe(1)
  await page.screenshot({ path: 'tests/.artifacts/land.png' })
})

test('a group can be offered to again, in the same quarter and the next', async ({ page }) => {
  await start(page)
  await sitePlants(page, 1)
  await drawRoute(page)
  await page.getByRole('button', { name: 'File this route' }).click()
  const farms = page.locator('.group', { hasText: 'Working farm' })
  const button = farms.getByRole('button')
  await button.click()
  await expect(button).toHaveText('Sent')
  await expect(farms.locator('.sent')).toContainText('offers out at 1.60×')
  await farms.locator('input').fill('1.8')
  await expect(button).toHaveText('Change')
  await button.click()
  await expect(farms.locator('.sent')).toContainText('1.80×')

  for (let q = 0; q < 3; q++) {
    await endQuarter(page)
    while (await answer(page)) await page.waitForTimeout(50)
    if (await farms.count() === 0) break
    await expect(button).toHaveText('Send')
    await expect(button).toBeEnabled()
    await button.click()
    await expect(button).toHaveText('Sent')
  }
})

test('plays the build phase through to operations', async ({ page }) => {
  test.setTimeout(120_000)
  await start(page)
  await sitePlants(page, 3)
  await drawRoute(page)
  await page.getByRole('button', { name: /230 kV double/ }).click()
  await page.getByRole('button', { name: 'File this route' }).click()
  for (let q = 0; q < 25 && (await state(page)).phase === 'build'; q++) {
    while (await answer(page)) await page.waitForTimeout(50)
    if ((await state(page)).corridors[0].status === 'acquiring') {
      if (await page.locator('.map-popover .land').count() === 0) {
        await tab(page, 'Grid')
        await page.locator('.line-pick').first().click()
      }
      if (q < 5) {
        const send = page.getByRole('button', { name: 'Send', exact: true })
        for (let n = await send.count(); n > 0; n--) await send.first().click()
      } else {
        const condemn = page.locator('.parcel').getByRole('button', { name: /Condemn/ })
        while (await condemn.count()) await condemn.first().click()
      }
    }
    const { approval } = (await state(page)).contract
    if (approval < 60) {
      await page.evaluate(() => {
        const s = (window as any).__game.getState()
        for (const id of ['fund', 'bill-credit', 'local-hiring', 'screening', 'meeting', 'roads']) s.runProgramme('13261', id)
      })
    }
    await endQuarter(page)
  }
  const g = await state(page)
  expect(g.phase).toBe('operate')
  expect(g.energizedQuarter).not.toBeNull()
  await expect(page.locator('.speeds')).toBeVisible()
  await expect(page.getByRole('button', { name: 'End quarter' })).toHaveCount(0)
})
