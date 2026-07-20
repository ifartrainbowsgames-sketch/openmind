// Stripe billing — currently in "coming soon" mode.
//
// The connected Stripe account runs in live mode, so no chargeable link is
// generated from the app. When you're ready to take payments:
//   1. Create a payment link for the "OpenMind Pro" product ($29/mo) in the
//      Stripe dashboard (test mode first, then live when launching).
//   2. Paste the URL below and wire it to the Upgrade button in
//      src/pages/Dashboard.tsx.
//   3. On successful checkout, set the user's row in the `subscriptions`
//      table to plan = 'pro' (Supabase) — the console picks it up on load.
export const PRO_CHECKOUT_URL: string | null = null
