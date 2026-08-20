/**
 * What a round of tool calls actually achieved.
 *
 * Without this the graph ran plan → act → act → respond, so a search
 * returning "No results found" flowed straight to the responder, which
 * composed an answer out of nothing. Evaluation is the node that turns an
 * empty result into another attempt instead of a confident fabrication.
 *
 * Kept apart from the benchmark harness in ./evaluation.ts — that scores
 * whole runs offline, this decides what happens next inside one.
 */

import type { ToolCall } from './types'

/** Replans allowed per run. One retry, then answer with what we have. */
export const MAX_REPLANS = 1

export type EvaluationVerdict = 'sufficient' | 'retry' | 'blocked'

export interface Evaluation {
  verdict: EvaluationVerdict
  reason: string
}

/**
 * Outputs that came back technically fine but carry no information. Kept broad
 * on purpose: tools phrase this a dozen ways ("No matching passages found",
 * "0 results", "nothing matched") and a missed phrasing means the graph
 * composes an answer out of nothing.
 */
const EMPTY_RESULT_RE =
  /\b(no\s+(matching|results?|matches|data|records|items|hits|passages)|not\s+found|nothing\s+(found|matched)|returned\s+nothing|empty\s+result|0\s+results)\b/i

/**
 * Decide what a round of tool calls actually achieved. This is the node the
 * graph was missing: without it a search returning "No results found" flowed
 * straight to the responder, which composed an answer anyway.
 */
export function evaluateObservations(observations: ToolCall[]): Evaluation {
  if (!observations.length) return { verdict: 'sufficient', reason: 'no tools were needed' }

  const blocked = observations.filter((o) => o.error?.kind === 'blocked')
  if (blocked.length === observations.length) {
    return { verdict: 'blocked', reason: blocked[0].error?.message ?? 'required capability unavailable' }
  }

  const failed = observations.filter((o) => o.error?.kind === 'error')
  if (failed.length) {
    return { verdict: 'retry', reason: `${failed.length} tool call(s) errored: ${failed[0].error?.message ?? 'unknown'}` }
  }

  // Short is not the same as useless — a calculator answering "42" is a
  // complete result. Only genuinely empty or explicitly no-result output counts.
  const useful = observations.filter(
    (o) => !o.error && o.output.trim().length > 0 && !EMPTY_RESULT_RE.test(o.output),
  )
  if (!useful.length) {
    return { verdict: 'retry', reason: 'every tool returned an empty or no-result response' }
  }

  return { verdict: 'sufficient', reason: `${useful.length} of ${observations.length} calls returned usable output` }
}

/** Annotate the original request with what already failed, for brains without replan(). */
export function replanPrompt(input: string, observations: ToolCall[], reason: string): string {
  const tried = observations
    .map((o) => `- ${o.tool}("${o.input.slice(0, 80)}") → ${o.error ? `ERROR: ${o.error.message}` : o.output.slice(0, 160)}`)
    .join('\n')
  return (
    `${input}\n\n` +
    `PREVIOUS ATTEMPT DID NOT WORK — ${reason}\n` +
    `Already tried:\n${tried}\n` +
    `Plan different tool calls. Do not repeat a call that already failed.`
  )
}

