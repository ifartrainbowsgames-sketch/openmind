/**
 * Which models a customer may choose, and what is known about each.
 *
 * Two sources, answering two different questions, and neither is sufficient
 * alone:
 *
 *   the CATALOGUE  what exists, with pricing / context / capabilities
 *                  (vendored models.dev snapshot — offline, no CDN in the
 *                  render path)
 *   DISCOVERY      what THIS customer's key can actually reach
 *                  (GET /v1/models, recorded when a provider is connected)
 *
 * The gap between them is not hypothetical. A real Groq key reached 13 models
 * while the catalogue listed 15, and the default OpenMind had hard-coded was
 * not among the 13 — a model that existed, was published, and returned
 * "does not exist or you do not have access" on the only account that mattered.
 */

import { MODEL_CATALOG } from './catalog.generated'
import type { CatalogModel } from './types'

export type { CatalogModel }
export { MODEL_CATALOG }
export { CATALOG_PROVIDERS } from './providers'

/** Everything the catalogue knows about a provider, newest first. */
export function catalogModels(providerId: string): readonly CatalogModel[] {
  return MODEL_CATALOG[providerId] ?? []
}

export function findModel(providerId: string, modelId: string): CatalogModel | undefined {
  return catalogModels(providerId).find((m) => m.id === modelId)
}

/**
 * The models to offer, given what the customer's key can reach.
 *
 * `reachable === undefined` means discovery has not run — offer the whole
 * catalogue rather than nothing, because an empty picker is indistinguishable
 * from a broken one.
 *
 * When discovery HAS run, the result is not a plain intersection. A reachable
 * id the catalogue has never heard of is still offered, carrying only its id:
 * the snapshot is a point in time and providers ship models between syncs, so
 * intersecting would hide exactly the newest model a customer went looking for.
 * Better a row with no pricing than no row.
 */
export function selectableModels(
  providerId: string,
  reachable?: readonly string[],
): readonly CatalogModel[] {
  const catalog = catalogModels(providerId)
  if (!reachable) return catalog

  const known = new Set(catalog.map((m) => m.id))
  const live = new Set(reachable)

  const inBoth = catalog.filter((m) => live.has(m.id))
  const unknownButReachable = reachable
    .filter((id) => !known.has(id))
    .map((id): CatalogModel => ({ id, name: id }))

  return [...inBoth, ...unknownButReachable]
}

/** "$3.00 / $15.00 per 1M" — or nothing, when the catalogue has no price. */
export function priceLabel(model: CatalogModel): string {
  const { inputCost, outputCost } = model
  if (inputCost === undefined && outputCost === undefined) return ''
  const money = (n?: number) => (n === undefined ? '?' : n === 0 ? 'free' : `$${n.toFixed(2)}`)
  return `${money(inputCost)} / ${money(outputCost)} per 1M`
}

/** "200K" / "1M" — compact enough to sit in a dropdown row. */
export function contextLabel(model: CatalogModel): string {
  const context = model.context
  if (!context) return ''
  if (context >= 1_000_000) return `${Math.round(context / 100_000) / 10}M ctx`
  return `${Math.round(context / 1000)}K ctx`
}

/**
 * Is this model a sane default for work OpenMind actually does?
 *
 * The graph plans with JSON and calls tools, so a model without tool support
 * is a poor default even when it is the newest thing a provider ships. Used to
 * pick a fallback, never to hide a model the customer explicitly chose.
 */
export function preferredDefault(providerId: string): CatalogModel | undefined {
  const models = catalogModels(providerId)
  return models.find((m) => m.tools && !m.reasoning) ?? models.find((m) => m.tools) ?? models[0]
}
