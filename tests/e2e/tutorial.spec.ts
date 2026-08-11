import { test, expect, type Page } from '@playwright/test'

/** The tutorial as a player meets it, in a real browser. */

async function sign(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Sign the contract' }).click()
  await expect(page.locator('.briefing')).toHaveCount(0)
}

/** Jump the game state to a given beat without playing eleven quarters. */
async function seedBeat(page: Page, beat: number, classId = '230'): Promise<void> {
  await page.evaluate(({ beat, classId }) => {
    const store = (window as unknown as { __game: any }).__game
    const game = structuredClone(store.getState().game)
    game.tutorial.beat = beat
    if (beat >= 6) {
      for (let i = 0; i < 3; i++) {
        game.plants.push({
          id: `plant-${i + 1}`, typeId: 'gas-ct', name: `Gas combustion turbine ${i + 1}`,
          cell: game.contract.siteCell, countyFips: '13261', status: 'online',
          quartersRemaining: 0, nameplateMw: 200, capexTotal: 0, capexSpent: 0,
          commissionedQuarter: 0, acceleratedQuarters: 0,
        })
      }
      game.corridors.push({
        id: 'corridor-1', name: 'test', classId, cells: [],
        centerline: [[-70, -50], [-50, -45]], lengthKm: 21, status: 'energized',
        deals: {}, takings: {}, condemnations: 0, legalCosts: 0, rowPaid: 0,
        capexTotal: 0, capexSpent: 0, buildQuartersRemaining: 0, delayQuarters: 0,
      })
      game.tutorial.hearingResolved = true
      game.energizedQuarter = 0
      game.phase = 'operate'
      game.realtime = {
        tick: 0, speed: 0, policy: 'proportional', outages: [], storms: [],
        crewsTotal: 3, vegetationSpend: 0.5, maintenanceDeferred: false,
        servedMwh: 0, unservedContractMwh: 0, unservedCustomerMwh: 0,
        fuelCost: 0, marketCost: 0, customerMinutesLost: 0, history: [],
      }
    }
    store.setState({ game })
  }, { beat, classId })
}

test('opens on the deal and coaches the first beat', async ({ page }) => {
  await page.goto('/')
  await sign(page)

  const coach = page.locator('.coach')
  await expect(coach).toBeVisible()
  await expect(coach.locator('.coach-step')).toContainText('of 9')
  // Signing satisfied beat one, so the coach has already moved on.
  await expect(coach.locator('.coach-title')).toContainText('Something has to make it')
})

test('glides the camera down to Sumter County', async ({ page }) => {
  await page.goto('/')
  const before = await page.locator('.scalebar-inner span').innerText()
  await sign(page)
  await page.waitForTimeout(1400)

  // The view is no longer statewide: the scale bar is reading a shorter distance.
  await expect(page.locator('.scalebar-inner span')).not.toHaveText(before)
  await expect(page.locator('.readout-hint, .readout-title')).toBeVisible()
  await page.screenshot({ path: 'tests/.artifacts/tutorial-open.png' })
})

test('the coach can be dismissed and does not come back', async ({ page }) => {
  await page.goto('/')
  await sign(page)
  await page.getByRole('button', { name: 'Dismiss the tutorial' }).click()
  await expect(page.locator('.coach')).toHaveCount(0)

  await page.getByRole('button', { name: 'End quarter' }).click()
  const cont = page.getByRole('button', { name: 'Continue' })
  if (await cont.count()) await cont.click()
  await expect(page.locator('.coach')).toHaveCount(0)
})

test('the hearing is a real choice with no free answer', async ({ page }) => {
  await page.goto('/')
  await sign(page)
  await seedBeat(page, 5)

  const hearing = page.locator('.hearing')
  await expect(hearing).toBeVisible()
  await expect(hearing).toContainText('Who pays for the line?')

  // Three options, and the cheap one says out loud what it costs.
  await expect(page.locator('.hearing-option')).toHaveCount(3)
  await expect(hearing).toContainText('Every household in the state picks up a share')

  await page.getByRole('button', { name: /Spread it across the rate base/ }).click()
  await expect(page.locator('.hearing')).toHaveCount(0)
  await expect(page.locator('.logstrip')).toContainText('rate base')
  await page.screenshot({ path: 'tests/.artifacts/hearing.png' })
})

test('the scripted storm takes a single-circuit campus dark', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/')
  await sign(page)
  await seedBeat(page, 7, '230')
  await page.evaluate(() => {
    const store = (window as unknown as { __game: any }).__game
    const game = store.getState().game
    game.tutorial.stormAtTick = 4
    store.setState({ game: { ...game } })
  })

  await page.getByRole('button', { name: '4 times speed' }).click()
  await expect(page.locator('.now-card.short')).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('.alert-stack')).toContainText('campus is dark')
  await page.screenshot({ path: 'tests/.artifacts/tutorial-storm.png' })
})

test('reaches the scorecard and reports every currency', async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto('/')
  await sign(page)
  await seedBeat(page, 8, '230d')
  await page.evaluate(() => {
    const store = (window as unknown as { __game: any }).__game
    const game = store.getState().game
    game.tutorial.stormAtTick = 2
    store.setState({ game: { ...game } })
  })

  // The clock stops itself on anything severe, so the storm pauses the game.
  // A player would hit play again; so does this.
  //
  // Deadline-based rather than a fixed iteration count: the game clock runs on
  // wall time, so on a loaded CPU (the full suite in parallel, or a CI runner)
  // a counted loop can burn all its iterations before the simulation has ticked
  // far enough. Bounding by elapsed time instead makes the test wait for the
  // thing it actually cares about.
  const score = page.locator('.score')
  const deadline = Date.now() + 100_000
  while (!(await score.count()) && Date.now() < deadline) {
    const play = page.getByRole('button', { name: '4 times speed' })
    if (await play.count()) await play.click({ timeout: 5_000 }).catch(() => {})
    await page.waitForTimeout(500)
  }
  await expect(score).toBeVisible({ timeout: 30_000 })

  await expect(score).toContainText('debrief')
  for (const part of ['On time', 'Capital', 'Community', 'Reliability', 'Restraint']) {
    await expect(score).toContainText(part)
  }
  await expect(score).toContainText('Properties condemned')
  await expect(score.locator('.score-grade strong')).toHaveText(/^[ABCDF]$/)
  await page.screenshot({ path: 'tests/.artifacts/scorecard.png' })

  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.locator('.score')).toHaveCount(0)
})
