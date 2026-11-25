import { expect, type Page } from '@playwright/test'

/** Sign the first data center and drop the rest of the company, so a test can be about one. */
export async function onlyLiberty(page: Page): Promise<void> {
  await page.evaluate(() => {
    const store = (window as any).__game
    const game = structuredClone(store.getState().game)
    game.customers = []
    delete game.offers
    game.cash = 0
    game.startingBudget = 0
    game.creditLimit = 600e6 - game.contract.contractedMw * 700e3
    store.setState({ game })
    store.getState().accept()
  })
}

export async function start(page: Page, transformers = true, company = false): Promise<void> {
  await page.goto('/?seed=7')
  await page.getByRole('button', { name: 'Start', exact: true }).click()
  await expect(page.locator('dialog.briefing')).toHaveCount(0)
  if (!company) await onlyLiberty(page)
  await page.waitForFunction(() => (window as any).__game.getState().parcels !== null)
  await page.waitForTimeout(1200)
  if (transformers) await installTransformers(page)
}

/** Put transformers everywhere, so a test can be about something else. */
export async function installTransformers(page: Page): Promise<void> {
  await page.evaluate(() => {
    const store = (window as any).__game
    const game = structuredClone(store.getState().game)
    game.equipment = ['campus-115', 'campus-230', 'campus-500', 'sub-230-115', 'sub-500-230'].flatMap((typeId) =>
      [1, 2, 3].map((n) => ({
        id: `gear-${typeId}-${n}`, typeId, status: 'installed', quartersRemaining: 0, capexTotal: 1e5, capexSpent: 1e5, rush: false,
      })))
    store.setState({ game })
  })
}

export const tab = (page: Page, name: string | RegExp) => page.getByRole('tab', { name }).click()

/** Click the map at a longitude and latitude, as projected by the running game. */
export async function clickAt(page: Page, fx: number, fy: number): Promise<void> {
  const b = (await page.locator('canvas.map-canvas').boundingBox())!
  await page.mouse.move(b.x + b.width * fx, b.y + b.height * fy)
  await page.mouse.click(b.x + b.width * fx, b.y + b.height * fy)
  await page.waitForTimeout(150)
}

export const PLANT: [number, number] = [0.8, 0.62]
export const CAMPUS: [number, number] = [0.5, 0.5]

export async function sitePlants(page: Page, n: number): Promise<void> {
  await tab(page, 'Build')
  for (let i = 0; i < n; i++) {
    await page.getByRole('button', { name: /Gas combustion turbine/ }).click()
    await clickAt(page, ...PLANT)
  }
  await expect(page.locator('.sited')).toHaveCount(n)
}

export async function drawRoute(page: Page): Promise<void> {
  await tab(page, 'Grid')
  await page.getByRole('button', { name: 'Plan a line', exact: true }).click()
  await clickAt(page, ...PLANT)
  await clickAt(page, ...CAMPUS)
  await expect(page.locator('.plan')).toBeVisible()
}

/** Answer whatever dialog is in the way. Returns true if there was one. */
export async function answer(page: Page): Promise<boolean> {
  const choice = page.locator('dialog.hearing .choice, dialog.event .choice').first()
  if (await choice.count() === 0) return false
  await choice.click()
  return true
}

export async function endQuarter(page: Page): Promise<void> {
  while (await answer(page)) await page.waitForTimeout(50)
  await page.getByRole('button', { name: 'End quarter' }).click()
  await page.waitForTimeout(60)
}

/** Put the game into operations at full load. */
export async function energize(page: Page, classId: '230' | '230d' = '230', day = 10): Promise<void> {
  await start(page)
  await sitePlants(page, 3)
  await drawRoute(page)
  if (classId === '230d') await page.getByRole('button', { name: /230 kV double/ }).click()
  await page.getByRole('button', { name: 'File this route' }).click()
  await page.evaluate((startDay) => {
    const store = (window as any).__game
    const game = structuredClone(store.getState().game)
    for (const p of game.plants) { p.status = 'online'; p.quartersRemaining = 0; p.capexSpent = p.capexTotal }
    for (const c of game.corridors) { c.status = 'energized'; c.capexSpent = c.capexTotal }
    game.hearing = 'resolved'
    game.energizedQuarter = game.quarter
    game.contract.status = 'served'
    game.phase = 'operate'
    game.scenarioId = 'full-load'
    game.cash = 2e8
    game.realtime = {
      tick: 0, startTick: startDay * 96, quartersClosed: 0, inShortfall: false, heatWave: null,
      demandResponse: null, nextEventTick: 1e9, speed: 0, policy: 'proportional', outages: [],
      storms: [], crewsTotal: 3, vegetationSpend: 0.5, maintenanceDeferred: false, servedMwh: 0,
      servedContractMwh: 0, servedCustomerMwh: 0, unservedContractMwh: 0, unservedCustomerMwh: 0,
      fuelCost: 0, marketCost: 0, customerMinutesLost: 0, history: [],
    }
    store.setState({ game })
    store.getState().select(null)
  }, day)
  await expect(page.locator('.speeds')).toBeVisible()
}

/** Fail one asset for a long time. */
export async function breakAsset(page: Page, kind: 'plant' | 'corridor', fraction = 0): Promise<void> {
  await page.evaluate(({ kind, fraction }) => {
    const store = (window as any).__game
    const game = store.getState().game
    const list = kind === 'plant' ? game.plants.slice(0, 2) : game.corridors
    for (const a of list) {
      game.realtime.outages.push({
        assetId: a.id, kind, cause: 'structure down', ticksRemaining: 4000,
        capacityFraction: fraction, crews: 0, startedTick: 0,
      })
    }
    store.setState({ game: { ...game } })
  }, { kind, fraction })
}

export async function runClock(page: Page, ms: number): Promise<void> {
  await page.getByRole('button', { name: 'One hour a second' }).click()
  await page.waitForTimeout(ms)
  await page.getByRole('button', { name: 'Pause' }).click()
}

export const state = (page: Page) =>
  page.evaluate(() => JSON.parse(JSON.stringify((window as any).__game.getState().game)))
