import { test, expect, type Page } from '@playwright/test'

/**
 * The M2 loop in a real browser: plan a route across Sumter County, see what it
 * takes from whom, commit it, make offers, and deal with whoever refuses.
 */

async function signContract(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Sign the contract' }).click()
  await expect(page.locator('.briefing')).toHaveCount(0)
}

async function clearHeadlines(page: Page): Promise<void> {
  const cont = page.getByRole('button', { name: 'Continue' })
  if (await cont.count()) await cont.click()
}

/** Zoom into south-west Georgia so map clicks land in Sumter County. */
async function zoomToSumter(page: Page): Promise<void> {
  const box = (await page.locator('canvas.map-canvas').boundingBox())!
  await page.mouse.move(box.x + box.width * 0.42, box.y + box.height * 0.66)
  for (let i = 0; i < 5; i++) {
    await page.mouse.wheel(0, -400)
    await page.waitForTimeout(120)
  }
}

/** Draw a corridor between two points on screen. */
async function drawRoute(page: Page): Promise<void> {
  const box = (await page.locator('canvas.map-canvas').boundingBox())!
  await page.mouse.click(box.x + box.width * 0.42, box.y + box.height * 0.55)
  await page.waitForTimeout(200)
  await page.mouse.click(box.x + box.width * 0.56, box.y + box.height * 0.45)
  await page.waitForTimeout(600)
}

test('plans a corridor and reports what it takes from whom', async ({ page }) => {
  test.setTimeout(90_000)
  await page.goto('/')
  await signContract(page)
  await zoomToSumter(page)

  await page.getByRole('button', { name: 'Plan a corridor' }).click()
  // The cadastre loads on demand, not at startup.
  await expect(page.locator('.class-picker')).toBeVisible()

  await drawRoute(page)

  const plan = page.locator('.plan-card')
  await expect(plan).toBeVisible()
  await expect(plan).toContainText('properties crossed')
  await expect(plan).toContainText('cut in two')
  // A stand-in cadastre must say so rather than passing as the real thing.
  await expect(page.locator('.synthetic-warning')).toBeVisible()

  await page.screenshot({ path: 'tests/.artifacts/corridor-plan.png' })
})

test('a wider voltage class takes more land over the same route', async ({ page }) => {
  test.setTimeout(90_000)
  await page.goto('/')
  await signContract(page)
  await zoomToSumter(page)
  await page.getByRole('button', { name: 'Plan a corridor' }).click()
  await drawRoute(page)
  await expect(page.locator('.plan-card')).toBeVisible()

  const acresText = async () =>
    (await page.locator('.plan-card dd').nth(2).innerText()).replace(/[^\d]/g, '')

  const at230 = Number(await acresText())
  await page.getByRole('button', { name: /500 kV/ }).click()
  await page.waitForTimeout(500)
  const at500 = Number(await acresText())

  expect(at500).toBeGreaterThan(at230)
})

test('commits a route and opens a negotiation for every parcel', async ({ page }) => {
  test.setTimeout(90_000)
  await page.goto('/')
  await signContract(page)
  await zoomToSumter(page)
  await page.getByRole('button', { name: 'Plan a corridor' }).click()
  await drawRoute(page)
  await page.getByRole('button', { name: 'Commit this route' }).click()

  await expect(page.locator('.parcel-list')).toBeVisible()
  const rows = page.locator('.parcel-row')
  expect(await rows.count()).toBeGreaterThan(3)
  await expect(page.locator('.acq-count')).toContainText('settled')

  // Owners are named as households and companies, never as individuals.
  await expect(rows.first().locator('.parcel-owner')).not.toHaveText('')

  await page.screenshot({ path: 'tests/.artifacts/acquisition.png' })
})

test('offers settle some owners and leave others refusing', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/')
  await signContract(page)
  await zoomToSumter(page)
  await page.getByRole('button', { name: 'Plan a corridor' }).click()
  await drawRoute(page)
  await page.getByRole('button', { name: 'Commit this route' }).click()

  await page.getByRole('button', { name: 'Send offers' }).click()
  await page.getByRole('button', { name: 'End quarter' }).click()
  await clearHeadlines(page)

  // Some accepted, and the log records the round.
  await expect(page.locator('.parcel-row.status-accepted').first()).toBeVisible()
  await expect(page.locator('.logstrip')).toContainText('signed')
})

test('condemning hardens everyone still holding out', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/')
  await signContract(page)
  await zoomToSumter(page)
  await page.getByRole('button', { name: 'Plan a corridor' }).click()
  await drawRoute(page)
  await page.getByRole('button', { name: 'Commit this route' }).click()

  // A bare-appraisal offer produces holdouts to work with.
  await page.getByRole('button', { name: 'Send offers' }).click()
  await page.getByRole('button', { name: 'End quarter' }).click()
  await clearHeadlines(page)

  const holdout = page.locator('.parcel-row.status-holdout').first()
  await expect(holdout).toBeVisible()
  await holdout.getByRole('button', { name: 'Condemn' }).click()

  await expect(page.locator('.parcel-row.status-condemning').first()).toBeVisible()
  // The contagion is stated to the player, not just modelled behind the scenes.
  await expect(page.locator('.panel-note').filter({ hasText: 'Word has got around' })).toBeVisible()
  await expect(page.locator('.logstrip')).toContainText('Condemnation filed')

  await page.screenshot({ path: 'tests/.artifacts/condemnation.png' })
})

test('plays the whole chain through to energization', async ({ page }) => {
  test.setTimeout(240_000)
  await page.goto('/')
  await signContract(page)
  await zoomToSumter(page)

  const box = (await page.locator('canvas.map-canvas').boundingBox())!

  // Generation first: three turbines, 570 MW firm against a 400 MW contract.
  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: /Gas combustion turbine/ }).click()
    await page.mouse.click(box.x + box.width * 0.42, box.y + box.height * 0.55)
    await page.waitForTimeout(150)
  }
  await expect(page.locator('.fleet li')).toHaveCount(3)

  // Then the wire.
  await page.getByRole('button', { name: 'Plan a corridor' }).click()
  await drawRoute(page)
  await page.getByRole('button', { name: 'Commit this route' }).click()
  await expect(page.locator('.parcel-list')).toBeVisible()

  // Pay generously and keep raising until nobody is left refusing; condemn
  // whoever still will not sell, because the deadline does not negotiate.
  for (let round = 0; round < 10; round++) {
    const settled = await page.locator('.acq-count').innerText()
    const [done, total] = settled.match(/(\d+) of (\d+)/)!.slice(1).map(Number)
    if (done >= total) break

    const slider = page.locator('.bulk-offer input[type="range"]')
    await slider.fill(String(Math.min(4, 1.5 + round * 0.35)))
    await page.getByRole('button', { name: 'Send offers' }).click()
    await page.getByRole('button', { name: 'End quarter' }).click()
    await clearHeadlines(page)

    if (round >= 4) {
      const holdouts = page.locator('.parcel-row.status-holdout')
      const n = await holdouts.count()
      for (let i = 0; i < n; i++) {
        await holdouts.nth(0).getByRole('button', { name: 'Condemn' }).click()
        await page.waitForTimeout(80)
      }
    }
  }

  // Run out the construction schedule.
  for (let q = 0; q < 22; q++) {
    if (await page.locator('.hud').innerText().then((t) => t.includes('Energized'))) break
    await page.getByRole('button', { name: 'End quarter' }).click()
    await clearHeadlines(page)
  }

  await expect(page.locator('.hud')).toContainText('Energized')
  await expect(page.locator('.logstrip')).toContainText('energized')
  await page.screenshot({ path: 'tests/.artifacts/energized.png' })
})
