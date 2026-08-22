/**
 * A model a customer can choose, and what it costs to choose it.
 *
 * Metadata comes from the vendored models.dev catalogue rather than from a
 * provider's own /v1/models — that endpoint returns ids and little else, and a
 * bare list of ids is not enough to choose between forty of them. Pricing and
 * context window are the two fields people actually pick on.
 */
export interface CatalogModel {
  id: string
  name: string
  /** Context window in tokens. */
  context?: number
  /** Maximum tokens the model will generate. */
  maxOutput?: number
  /** USD per million tokens. */
  inputCost?: number
  outputCost?: number
  tools?: boolean
  reasoning?: boolean
  vision?: boolean
  /** ISO date, used to sort newest-first. */
  released?: string
}
