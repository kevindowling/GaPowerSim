import { test, expect, type Page } from '@playwright/test'

/**
 * The M1 loop end to end, in a real browser: read the offer, sign it, site a
 * plant on the map, and push quarters until the power is on.
 */

async function signContract(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Sign the contract' }).click()
  await expect(page.locator('.briefing')).toHaveCount(0)
}

/** Dismiss the end-of-quarter summary if one appeared. */
async function clearHeadlines(page: Page): Promise<void> {
  const cont = page.getByRole('button', { name: 'Continue' })
  if (await cont.count()) await cont.click()
}

/** Zoom the map in on the campus marker so map clicks land in Sumter County. */
async function zoomToCampus(page: Page): Promise<void> {
  const canvas = page.locator('canvas.map-canvas')
  const box = (await canvas.boundingBox())!
  // The campus sits in south-west Georgia; aim there, then zoom about that point.
  const target = { x: box.x + box.width * 0.42, y: box.y + box.height * 0.66 }
  await page.mouse.move(target.x, target.y)
  for (let i = 0; i < 6; i++) {
    await page.mouse.wheel(0, -400)
    await page.waitForTimeout(120)
  }
}

test('shows the offer before anything is committed', async ({ page }) => {
  await page.goto('/')
  const briefing = page.locator('.briefing')
  await expect(briefing).toBeVisible()
  await expect(briefing).toContainText('400 MW')
  await expect(briefing).toContainText('2029 Q4')
  // Americus is a real, sourced project — and the card separates what is
  // reported from what we invented to make a game, rather than blurring them.
  await expect(briefing).toContainText('real project')
  await expect(briefing).toContainText('invented')
  await expect(briefing.locator('.briefing-sources a').first()).toHaveAttribute(
    'href',
    /americustimesrecorder\.com/,
  )

  // No capital has moved yet.
  await expect(page.locator('.hud')).toContainText('$0')
})

test('signing releases the first milestone payment', async ({ page }) => {
  await page.goto('/')
  await signContract(page)
  // 20% of a $1.05B advance.
  await expect(page.locator('.hud')).toContainText('$210M')
  await expect(page.locator('.milestones li').first()).toHaveClass(/done/)
})

test('siting a plant costs approval and starts the clock', async ({ page }) => {
  await page.goto('/')
  await signContract(page)
  await zoomToCampus(page)

  await page.getByRole('button', { name: /Gas combustion turbine/ }).click()
  await expect(page.locator('.panel-hint')).toContainText('click the map')

  const canvas = page.locator('canvas.map-canvas')
  const box = (await canvas.boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)

  // A plant now exists and the fleet lists it.
  await expect(page.locator('.fleet li')).toHaveCount(1)
  await expect(page.locator('.fleet-meta').first()).toContainText('permitting')
  await page.screenshot({ path: 'tests/.artifacts/sited.png' })
})

test('quarters advance and the deadline closes in', async ({ page }) => {
  await page.goto('/')
  await signContract(page)
  await expect(page.locator('.hud')).toContainText('2026 Q1')

  await page.getByRole('button', { name: 'End quarter' }).click()
  await clearHeadlines(page)
  await expect(page.locator('.hud')).toContainText('2026 Q2')
})

test('generation alone does not serve the load — it needs a wire', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/')
  await signContract(page)
  await zoomToCampus(page)

  const canvas = page.locator('canvas.map-canvas')
  const box = (await canvas.boundingBox())!

  // Three 200 MW turbines at 95% firm is 570 MW — comfortably over the 400 MW
  // contracted, and still worth nothing without a corridor to the campus.
  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: /Gas combustion turbine/ }).click()
    await page.mouse.click(
      box.x + box.width * (0.44 + i * 0.04),
      box.y + box.height * (0.5 + i * 0.03),
    )
    await page.waitForTimeout(120)
  }
  await expect(page.locator('.fleet li')).toHaveCount(3)

  // Permitting plus construction for a CT is eleven quarters.
  for (let q = 0; q < 12; q++) {
    await page.getByRole('button', { name: 'End quarter' }).click()
    await clearHeadlines(page)
  }

  await expect(page.locator('.logstrip')).toContainText('is online')
  // Plants are running, and the contract is still not served.
  await expect(page.locator('.hud')).not.toContainText('Energized')
  await page.screenshot({ path: 'tests/.artifacts/generation-only.png' })
})

test('warns that solar cannot serve a round-the-clock load', async ({ page }) => {
  await page.goto('/')
  await signContract(page)
  const solar = page.getByRole('button', { name: /Utility-scale solar/ })
  // The card states firm capacity next to nameplate, which is the whole lesson.
  await expect(solar).toContainText('16 MW firm')
  await expect(solar).toContainText('200 MW nameplate')
})


test('a plant put in the wrong place can be moved', async ({ page }) => {
  await page.goto('/')
  await signContract(page)

  const box = (await page.locator('canvas').boundingBox())!
  await page.locator('.plant-card').first().click()
  await page.mouse.click(box.x + box.width * 0.45, box.y + box.height * 0.5)

  const sited = page.locator('.sited').first()
  await expect(sited).toContainText('Permitting')

  const before = await page.evaluate(() => {
    const g = (window as unknown as { __game: any }).__game.getState().game
    return { cash: g.cash, cell: g.plants[0].cell, land: g.plants[0].landCost }
  })

  // Siting used to be a one-way door: no undo, no move, nothing in the UI even
  // hinting the placement was final.
  await sited.getByRole('button', { name: 'Move' }).click()
  await expect(page.locator('.sited')).toHaveCount(0)

  const refunded = await page.evaluate(() => {
    const g = (window as unknown as { __game: any }).__game.getState().game
    return g.cash
  })
  // Most of the land comes back, but not all of it — this is not a free undo.
  expect(refunded).toBeGreaterThan(before.cash)
  expect(refunded).toBeLessThan(before.cash + before.land)

  await page.locator('.plant-card').first().click()
  await page.mouse.click(box.x + box.width * 0.58, box.y + box.height * 0.4)
  const moved = await page.evaluate(() => {
    const g = (window as unknown as { __game: any }).__game.getState().game
    return { n: g.plants.length, cell: g.plants[0].cell }
  })
  expect(moved.n).toBe(1)
  expect(moved.cell).not.toBe(before.cell)
})

test('the map layers say what they are for', async ({ page }) => {
  await page.goto('/')
  await signContract(page)

  const controls = page.locator('.map-controls')
  await expect(controls).toContainText('Map layer')

  // An unlabelled row of three words gave no reason to press any of them.
  await expect(page.locator('.controls-help')).toContainText('Switch layers')
  await page.getByRole('button', { name: 'Land value' }).click()
  await expect(page.locator('.controls-help')).toContainText('right-of-way')
  await expect(page.locator('.ramp-landValue')).toBeVisible()
})
