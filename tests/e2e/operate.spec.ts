import { test, expect, type Page } from '@playwright/test'

/**
 * The operate phase in a real browser. Rather than play eleven quarters of
 * construction through the UI every time, these tests reach into the store and
 * energize the grid directly, then drive the live clock.
 */

/** Put the game straight into operations with generation and a line. */
async function energize(page: Page, classId: '230' | '230d' = '230'): Promise<void> {
  await page.goto('/')
  await page.getByRole('button', { name: 'Sign the contract' }).click()

  await page.evaluate((cls) => {
    const store = (window as unknown as { __game: any }).__game
    const s = store.getState()
    const game = structuredClone(s.game)

    for (let i = 0; i < 3; i++) {
      game.plants.push({
        id: `plant-${i + 1}`, typeId: 'gas-ct', name: `Gas combustion turbine ${i + 1}`,
        cell: game.contract.siteCell, countyFips: '13261', status: 'online',
        quartersRemaining: 0, nameplateMw: 200, capexTotal: 0, capexSpent: 0,
        commissionedQuarter: 0, acceleratedQuarters: 0,
      })
    }
    game.corridors.push({
      id: 'corridor-1', name: 'test', classId: cls, cells: [],
      centerline: [[-70, -50], [-50, -45]], lengthKm: 21, status: 'energized',
      deals: {}, takings: {}, condemnations: 0, legalCosts: 0, rowPaid: 0,
      capexTotal: 0, capexSpent: 0, buildQuartersRemaining: 0, delayQuarters: 0,
    })
    game.energizedQuarter = 0
    game.phase = 'operate'
    game.realtime = {
      tick: 0, speed: 0, policy: 'proportional', outages: [], storms: [],
      crewsTotal: 3, vegetationSpend: 0.5, maintenanceDeferred: false,
      servedMwh: 0, unservedContractMwh: 0, unservedCustomerMwh: 0,
      fuelCost: 0, marketCost: 0, customerMinutesLost: 0, history: [],
    }
    store.setState({ game })
  }, classId)

  await expect(page.locator('.clock')).toBeVisible()
}

test('shows the control room once the load is energized', async ({ page }) => {
  await energize(page)
  await expect(page.getByRole('heading', { name: 'Operations' })).toBeVisible()
  await expect(page.locator('.clock')).toContainText(':')
  await expect(page.getByRole('group', { name: 'Simulation speed' })).toBeVisible()
})

test('the clock runs and the load chart fills in', async ({ page }) => {
  await energize(page)
  const before = await page.locator('.clock').innerText()

  await page.getByRole('button', { name: '4 times speed' }).click()
  await page.waitForTimeout(1600)

  await expect(page.locator('.clock')).not.toHaveText(before)
  await expect(page.locator('.load-chart')).toBeVisible()
  await expect(page.locator('.now-value')).toContainText('MW')

  // Pause and confirm it actually stops.
  await page.getByRole('button', { name: 'Pause' }).click()
  const paused = await page.locator('.clock').innerText()
  await page.waitForTimeout(700)
  await expect(page.locator('.clock')).toHaveText(paused)

  await page.screenshot({ path: 'tests/.artifacts/operations.png' })
})

test('a single-circuit line going down takes the campus with it', async ({ page }) => {
  await energize(page, '230')
  await page.evaluate(() => {
    const store = (window as unknown as { __game: any }).__game
    const game = store.getState().game
    game.realtime.outages.push({
      assetId: 'corridor-1', kind: 'corridor', cause: 'structure down',
      ticksRemaining: 200, capacityFraction: 0, crews: 0, startedTick: 0,
    })
    store.setState({ game: { ...game } })
  })
  await page.getByRole('button', { name: '2 times speed' }).click()
  await page.waitForTimeout(1200)

  await expect(page.locator('.now-card.short')).toBeVisible()
  await expect(page.locator('.now-short')).toContainText('not delivered')
  await expect(page.locator('.outage-list li').first()).toContainText('structure down')
  await page.screenshot({ path: 'tests/.artifacts/line-down.png' })
})

test('a double-circuit line rides out the same damage', async ({ page }) => {
  await energize(page, '230d')
  await page.evaluate(() => {
    const store = (window as unknown as { __game: any }).__game
    const game = store.getState().game
    // One of two circuits lost — exactly what the extra money bought.
    game.realtime.outages.push({
      assetId: 'corridor-1', kind: 'corridor', cause: 'structure down',
      ticksRemaining: 200, capacityFraction: 0.5, crews: 0, startedTick: 0,
    })
    store.setState({ game: { ...game } })
  })
  await page.getByRole('button', { name: '2 times speed' }).click()
  await page.waitForTimeout(1200)

  // Still serving: 800 MW rating halved is 400, which is the whole campus.
  await expect(page.locator('.now-card.short')).toHaveCount(0)
  await expect(page.locator('.line-status')).toContainText('one circuit')
})

test('the curtailment policy is a real choice', async ({ page }) => {
  await energize(page)
  await expect(page.getByRole('radio', { name: /Homes first/ })).toBeVisible()
  await page.getByRole('radio', { name: /Contract first/ }).click()
  await expect(page.getByRole('radio', { name: /Contract first/ })).toHaveAttribute('aria-checked', 'true')
  // The consequence is stated plainly rather than hidden in a tooltip.
  await expect(page.locator('.policy-btn.on')).toContainText('lights go off in Sumter County')
})

test('deferring maintenance warns about what it costs', async ({ page }) => {
  await energize(page)
  await page.getByLabel('Defer maintenance').check()
  await expect(page.locator('.panel-note.tone-warn')).toContainText('doubles the rate')
})
