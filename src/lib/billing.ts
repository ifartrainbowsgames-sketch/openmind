// Stripe billing — currently in "coming soon" mode.
//
// The connected Stripe account runs in live mode, so no chargeable link is
// generated from the app. When you're ready to take payments:
//   1. Create a payment link for the "OpenMind Pro" product ($10/mo) in the
//      Stripe dashboard (test mode first, then live when launching).
//   2. Paste the URL below and wire it to the Upgrade button in
//      src/pages/Dashboard.tsx.
//   3. A verified Stripe webhook updates `subscriptions` and mirrors the plan
//      into `profiles` with the Supabase service role. Browser clients cannot
//      update billing fields.
export const PRO_CHECKOUT_URL: string | null = null
