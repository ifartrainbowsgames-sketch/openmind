import { expect, test } from '@playwright/test'

test('marketing site exposes the main navigation', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('main')).toBeVisible()
  await expect(page.getByRole('link', { name: /openmind/i }).first()).toBeVisible()
  await expect(page.getByRole('link', { name: /ai employees/i }).first()).toBeVisible()
})

test('login clearly identifies demo mode without Supabase env', async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByRole('heading', { name: 'Sign in.' })).toBeVisible()
  await expect(page.getByText(/demo mode — accounts live in this browser/i)).toBeVisible()
})

test('unauthenticated dashboard redirects to login', async ({ page }) => {
  await page.goto('/dashboard')
  await expect(page).toHaveURL(/\/login$/)
})

test('employees route renders the workforce surface', async ({ page }) => {
  await page.goto('/employees')
  await expect(page.getByRole('main')).toBeVisible()
  await expect(page.getByText(/ai employees/i).first()).toBeVisible()
})
