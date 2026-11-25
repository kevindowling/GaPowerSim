import { test, expect } from '@playwright/test'
import { start, sitePlants, state } from './helpers.ts'

test('moves on when the player does the thing', async ({ page }) => {
  await start(page)
  const title = page.locator('.coach-title')
  await expect(title).toHaveText('Build firm generation')
  await sitePlants(page, 3)
  await expect(title).toHaveText('Connect it to the campus')
  await page.getByRole('button', { name: 'Open Grid' }).click()
  await expect(page.getByRole('heading', { name: 'Lines' })).toBeVisible()
})

test('can be hidden and brought back', async ({ page }) => {
  await start(page)
  await page.getByRole('button', { name: 'Hide the guide' }).click()
  await expect(page.locator('.coach')).toHaveCount(0)
  await page.getByRole('button', { name: 'Show the guide' }).click()
  await expect(page.locator('.coach')).toBeVisible()
})

test('does not cover the map', async ({ page }) => {
  await start(page)
  const coach = (await page.locator('.coach').boundingBox())!
  const map = (await page.locator('canvas.map-canvas').boundingBox())!
  expect(coach.x).toBeGreaterThanOrEqual(map.x + map.width - 1)
})

test('the hearing is held with hints hidden, and has a cost either way', async ({ page }) => {
  await start(page)
  await page.getByRole('button', { name: 'Hide the guide' }).click()
  await page.evaluate(() => {
    const store = (window as any).__game
    store.setState({ game: { ...store.getState().game, hearing: 'called' } })
  })
  await expect(page.locator('dialog.hearing .choice')).toHaveCount(3)
  const before = await state(page)
  await page.getByRole('button', { name: /Charge it to the rate base/ }).click()
  const after = await state(page)
  expect(after.cash).toBeGreaterThanOrEqual(before.cash)
  expect(after.contract.approval).toBe(before.contract.approval - 22)
})

test('only one dialog is open at a time', async ({ page }) => {
  await start(page)
  await page.evaluate(() => {
    const store = (window as any).__game
    store.setState({
      game: { ...store.getState().game, hearing: 'called', pendingEvent: { id: 'training' } },
      headlines: ['Something happened.'],
    })
  })
  await expect(page.locator('dialog[open]')).toHaveCount(1)
  await page.locator('dialog.hearing .choice').first().click()
  await expect(page.locator('dialog[open]')).toHaveCount(1)
  await page.locator('dialog.event .choice').first().click()
  await expect(page.locator('dialog[open]')).toHaveCount(0)
})
