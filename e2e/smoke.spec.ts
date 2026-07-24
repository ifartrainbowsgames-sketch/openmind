import { expect, test } from '@playwright/test'

test('marketing site exposes the main navigation', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('main')).toBeVisible()
  await expect(page.getByRole('link', { name: /openmind/i }).first()).toBeVisible()
  await expect(page.getByRole('link', { name: 'Employees', exact: true }).first()).toBeVisible()
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
  await expect(page.getByRole('heading', { name: /hire an ai workforce/i })).toBeVisible()
})

test('connection marketplace exposes n8n and OpenClaw plugins', async ({ page }) => {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Sign up', exact: true }).click()
  await page.getByLabel('Email').fill('marketplace@example.com')
  await page.getByLabel('Password').fill('testing123')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/dashboard$/)
  await page.getByRole('button', { name: 'AI Employees' }).click()
  await page.getByRole('button', { name: /Connections\s+0 ready/i }).click()
  await expect(page.getByText('Connection marketplace', { exact: true })).toBeVisible()
  await expect(page.getByText('n8n', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('OpenClaw', { exact: true }).first()).toBeVisible()
})

test('chatbot dashboard connects availability and staff settings', async ({ page }) => {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Sign up', exact: true }).click()
  await page.getByLabel('Email').fill('staff-routing@example.com')
  await page.getByLabel('Password').fill('testing123')
  await page.getByRole('button', { name: 'Create account' }).click()

  await expect(page.getByRole('heading', { name: 'Chatbot home' })).toBeVisible()
  const availability = page.getByRole('switch', { name: 'Customer chatbot availability' })
  await expect(availability).toHaveAttribute('aria-checked', 'true')
  await availability.click()
  await expect(availability).toHaveAttribute('aria-checked', 'false')

  await page.getByRole('button', { name: 'Staff & availability' }).click()
  await expect(page.getByRole('heading', { name: 'Staff & availability' })).toBeVisible()
  await page.getByLabel('Staff name').fill('Alex')
  await page.getByLabel('Staff email').fill('alex@example.com')
  await page.getByRole('button', { name: 'Add staff' }).click()
  await expect(page.getByText('Alex', { exact: true })).toBeVisible()
  await expect(page.getByRole('switch', { name: 'Accept call requests' }).last()).toBeVisible()
})
