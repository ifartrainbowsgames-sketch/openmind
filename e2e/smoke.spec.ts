import { expect, test } from '@playwright/test'

test('marketing site exposes the main navigation', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('main')).toBeVisible()
  await expect(page.getByRole('link', { name: /openmind/i }).first()).toBeVisible()
  await expect(page.getByRole('link', { name: 'Chatbot', exact: true }).first()).toBeVisible()
})

test('login stays focused on customer workspace access', async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByRole('heading', { name: 'Sign in.' })).toBeVisible()
  await expect(page.getByText(/continue managing your chatbot/i)).toBeVisible()
})

test('unauthenticated dashboard redirects to login', async ({ page }) => {
  await page.goto('/dashboard')
  await expect(page).toHaveURL(/\/login$/)
})

test('legacy employees route is consolidated into the workspace', async ({ page }) => {
  await page.goto('/employees')
  await expect(page).toHaveURL(/\/login$/)
})

test('connection marketplace exposes n8n and OpenClaw plugins', async ({ page }) => {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Sign up', exact: true }).click()
  await page.getByLabel('Email').fill('marketplace@example.com')
  await page.getByLabel('Password').fill('testing123')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/dashboard$/)
  await page.getByRole('button', { name: 'Apps', exact: true }).click()
  await expect(page.getByText('Apps', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('n8n', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('OpenClaw', { exact: true }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Install', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Set up manually' })).toBeVisible()
})

test('chatbot dashboard connects availability and staff settings', async ({ page }) => {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Sign up', exact: true }).click()
  await page.getByLabel('Email').fill('staff-routing@example.com')
  await page.getByLabel('Password').fill('testing123')
  await page.getByRole('button', { name: 'Create account' }).click()

  await expect(page.getByRole('heading', { name: 'Your chatbot', level: 2 })).toBeVisible()
  const availability = page.getByRole('switch', { name: 'Customer chatbot availability' })
  await expect(availability).toHaveAttribute('aria-checked', 'true')
  await availability.click()
  await expect(availability).toHaveAttribute('aria-checked', 'false')

  await page.getByRole('button', { name: 'Team', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Team', level: 2 })).toBeVisible()
  await page.getByLabel('Staff name').fill('Alex')
  await page.getByLabel('Staff email').fill('alex@example.com')
  await page.getByRole('button', { name: 'Add person' }).click()
  await expect(page.getByText('Alex', { exact: true })).toBeVisible()
  await expect(page.getByRole('switch', { name: 'Accept call requests' }).last()).toBeVisible()
})

test('chatbot designer supports custom colors and versioned publishing', async ({ page }) => {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Sign up', exact: true }).click()
  await page.getByLabel('Email').fill('designer@example.com')
  await page.getByLabel('Password').fill('testing123')
  await page.getByRole('button', { name: 'Create account' }).click()

  await page.getByRole('button', { name: 'Chatbot', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Chatbot designer' })).toBeVisible()
  await page.getByLabel('Header hex value').fill('#123456')
  await page.getByRole('button', { name: 'Save draft' }).click()
  await expect(page.getByRole('button', { name: 'Draft saved' })).toBeVisible()
  await page.getByRole('button', { name: 'Publish', exact: true }).last().click()
  await page.getByRole('button', { name: 'Publish', exact: true }).first().click()
  await expect(page.getByText('Version 1')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Restore draft' })).toBeVisible()
})
