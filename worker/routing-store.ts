/**
 * Routing evidence in Postgres.
 *
 * Written with the service role, because a customer must be able to READ their
 * own routing history — which model ran their work, and what it cost — without
 * being able to write it. Evidence a customer can forge is not evidence, so the
 * RLS policies grant `select` only and there is no insert policy at all.
 *
 * Recording is deliberately best-effort. Evidence is valuable, not load-bearing:
 * a database hiccup must never take a customer's task down with it, and a
 * missing row is a gap in a dataset rather than a failed run.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  rebuildStats,
  type DecisionType, type RoutingArmStats, type RoutingDecision,
  type RoutingEvidenceStore, type RoutingObservation,
} from '../src/lib/workforce/routing-evidence'

export function createRoutingStore(db: SupabaseClient): RoutingEvidenceStore {
  return {
    async recordDecision(decision: RoutingDecision): Promise<void> {
      const { error } = await db.from('routing_decisions').insert({
        id: decision.id,
        user_id: decision.userId,
        project_id: decision.projectId ?? null,
        task_id: decision.taskId ?? null,
        decision_type: decision.decisionType,
        scope: decision.scope,
        chosen_candidate_id: decision.chosenCandidateId,
        candidate_set: decision.candidateSet,
        context_features: decision.contextFeatures,
        policy: decision.policy,
        trace_id: decision.traceId ?? null,
        created_at: new Date(decision.createdAt).toISOString(),
      })
      if (error) console.warn(`routing evidence: decision not recorded — ${error.message}`)
    },

    async recordObservation(observation: RoutingObservation): Promise<void> {
      const m = observation.metrics
      const { error } = await db.from('routing_observations').insert({
        id: observation.id,
        decision_id: observation.decisionId,
        user_id: observation.userId,
        outcome: observation.outcome,
        acceptance_score: m.acceptanceScore ?? null,
        cost_usd: m.costUsd ?? null,
        latency_ms: m.latencyMs ?? null,
        retries: m.retries ?? null,
        needed_user: m.neededUser ?? null,
        invalid_tool_calls: m.invalidToolCalls ?? null,
        specialist_id: observation.specialistId ?? null,
        skill_id: observation.skillId ?? null,
        skill_version: observation.skillVersion ?? null,
        runtime_id: observation.runtimeId ?? null,
        model_id: observation.modelId ?? null,
        provider_id: observation.providerId ?? null,
        // The raw metrics, so a corrected reward function can be applied to
        // history instead of only to the future.
        metrics: m,
        created_at: new Date(observation.createdAt).toISOString(),
      })
      if (error) console.warn(`routing evidence: observation not recorded — ${error.message}`)
    },

    /**
     * Counters, rebuilt from raw rows rather than read from the derived table.
     *
     * The derived table exists as a cache for a router that does not exist yet.
     * Until something maintains it, reading it would be reading a table nobody
     * writes — so this reads the truth and derives, which is also the check
     * that the two can never disagree.
     */
    async statsFor(scope: string, decisionType: DecisionType): Promise<RoutingArmStats[]> {
      const { data: decisions, error } = await db
        .from('routing_decisions')
        .select('id, scope, decision_type, chosen_candidate_id, policy')
        .eq('scope', scope)
        .eq('decision_type', decisionType)
        .limit(5000)
      if (error || !decisions?.length) return []

      const ids = decisions.map((d) => String(d.id))
      const { data: observations } = await db
        .from('routing_observations')
        .select('id, decision_id, outcome, created_at')
        .in('decision_id', ids)
        .limit(20_000)

      return rebuildStats(
        decisions.map((d) => ({
          id: String(d.id),
          userId: '',
          decisionType: d.decision_type as DecisionType,
          scope: String(d.scope),
          chosenCandidateId: String(d.chosen_candidate_id),
          candidateSet: [],
          contextFeatures: {},
          policy: d.policy as RoutingDecision['policy'],
          createdAt: 0,
        })),
        (observations ?? []).map((o) => ({
          id: String(o.id),
          decisionId: String(o.decision_id),
          userId: '',
          outcome: o.outcome as RoutingObservation['outcome'],
          metrics: {},
          createdAt: Date.parse(String(o.created_at)) || Date.now(),
        })),
      )
    },

    async decisionsFor(taskId: string): Promise<RoutingDecision[]> {
      const { data } = await db
        .from('routing_decisions')
        .select('*')
        .eq('task_id', taskId)
        .limit(100)
      return (data ?? []).map((d) => ({
        id: String(d.id),
        userId: String(d.user_id),
        projectId: d.project_id ? String(d.project_id) : undefined,
        taskId: d.task_id ? String(d.task_id) : undefined,
        decisionType: d.decision_type as DecisionType,
        scope: String(d.scope),
        chosenCandidateId: String(d.chosen_candidate_id),
        candidateSet: Array.isArray(d.candidate_set) ? (d.candidate_set as string[]) : [],
        contextFeatures: (d.context_features ?? {}) as RoutingDecision['contextFeatures'],
        policy: d.policy as RoutingDecision['policy'],
        traceId: d.trace_id ? String(d.trace_id) : undefined,
        createdAt: Date.parse(String(d.created_at)) || Date.now(),
      }))
    },
  }
}
