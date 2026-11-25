import { test, expect } from '@playwright/test'
import { energize, breakAsset, runClock, state } from './helpers.ts'

test('the clock runs, and stops', async ({ page }) => {
  await energize(page)
  const clock = page.locator('.clock')
  const before = await clock.innerText()
  await runClock(page, 1500)
  await expect(clock).not.toHaveText(before)
  await expect(page.locator('.chart')).toBeVisible()
  const paused = await clock.innerText()
  await page.waitForTimeout(600)
  await expect(clock).toHaveText(paused)
  await page.screenshot({ path: 'tests/.artifacts/operations.png' })
})

test('a single line down takes the campus with it', async ({ page }) => {
  await energize(page, '230')
  await breakAsset(page, 'corridor')
  await page.getByRole('button', { name: 'One hour a second' }).click()
  await expect(page.locator('.now.short')).toBeVisible()
  await expect(page.locator('.now-short')).toContainText('campus short')
  await expect(page.locator('.faults')).toContainText('structure down')
  await expect(page.locator('.toast.alerts')).toContainText('Not enough power')
})

test('one of two circuits carries the campus', async ({ page }) => {
  await energize(page, '230d')
  await breakAsset(page, 'corridor', 0.5)
  await runClock(page, 1500)
  await expect(page.locator('.now.short')).toHaveCount(0)
  await expect(page.locator('.faults')).toContainText('400 MW still available')
})

test('the policy decides who loses power', async ({ page }) => {
  const lost = async (policy: RegExp) => {
    await page.evaluate(() => localStorage.clear()).catch(() => {})
    await energize(page, '230d', 200)
    await breakAsset(page, 'plant')
    await page.getByRole('radio', { name: policy }).click()
    for (let i = 0; i < 3; i++) await runClock(page, 700)
    return (await state(page)).realtime
  }
  const homes = await lost(/Homes first/)
  const campus = await lost(/Campus first/)
  expect(homes.unservedCustomerMwh).toBeLessThan(0.5)
  expect(campus.unservedCustomerMwh).toBeGreaterThan(1)
  expect(campus.unservedContractMwh / campus.tick).toBeLessThan(homes.unservedContractMwh / homes.tick)
})

test('upkeep shows its cost', async ({ page }) => {
  await energize(page)
  const row = page.locator('.field', { hasText: 'Repair crews' })
  await expect(row).toContainText('$4.2M/yr')
  await page.getByRole('button', { name: 'One more crew' }).click()
  await expect(row).toContainText('$5.6M/yr')
  await page.getByLabel(/Defer plant maintenance/).check()
  await expect(page.locator('.field', { hasText: 'Defer' })).toContainText('2.2×')
})

test('crews can be sent to one fault first', async ({ page }) => {
  await energize(page)
  await breakAsset(page, 'plant')
  await page.getByRole('button', { name: 'Send crews here first' }).first().click()
  await expect(page.getByRole('button', { name: 'First in line' })).toBeVisible()
})

test('ends with a scorecard and a way to play again', async ({ page }) => {
  await energize(page, '230d')
  await page.evaluate(() => {
    const store = (window as any).__game
    const game = store.getState().game
    game.realtime.tick = 365 * 96 - 8
    game.realtime.quartersClosed = 3
    store.setState({ game: { ...game } })
  })
  await page.getByRole('button', { name: 'Six hours a second' }).click()
  const score = page.locator('dialog.score')
  await expect(score).toBeVisible({ timeout: 10_000 })
  await expect(score).toContainText('Your balance is your score')
  await page.screenshot({ path: 'tests/.artifacts/score.png' })
  await page.getByRole('button', { name: 'Start a new game' }).click()
  await expect(page.locator('dialog.menu')).toBeVisible()
})
