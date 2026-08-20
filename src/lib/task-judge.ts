import type { ArtifactRecord, JudgeVerdict, TaskRecord } from './task-ledger'

export function judgeArtifact(task: TaskRecord, artifact: ArtifactRecord): JudgeVerdict {
  const problems: string[] = []
  const requiredFixes: string[] = []
  const acceptance = task.acceptance ?? {}
  let score = 100

  if (acceptance.minBodyLength && artifact.body.trim().length < acceptance.minBodyLength) {
    problems.push(`Artifact too short (${artifact.body.trim().length} < ${acceptance.minBodyLength} chars)`)
    requiredFixes.push(`Expand ${artifact.path} to at least ${acceptance.minBodyLength} characters`)
    score -= 30
  }

  for (const needle of acceptance.mustInclude ?? []) {
    if (!artifact.body.includes(needle)) {
      problems.push(`Missing required content: "${needle}"`)
      requiredFixes.push(`Include "${needle}" in ${artifact.path}`)
      score -= 15
    }
  }

  if (acceptance.minSources && (artifact.sources ?? 0) < acceptance.minSources) {
    problems.push(`Only ${artifact.sources ?? 0} sources (need ${acceptance.minSources})`)
    requiredFixes.push(`Add at least ${acceptance.minSources - (artifact.sources ?? 0)} more cited sources`)
    score -= 25
  }

  if (acceptance.minArrayLength && artifact.kind === 'json') {
    try {
      const parsed = JSON.parse(artifact.body) as Record<string, unknown>
      for (const [key, min] of Object.entries(acceptance.minArrayLength)) {
        const arr = parsed[key]
        const len = Array.isArray(arr) ? arr.length : 0
        if (len < min) {
          problems.push(`Only ${len} items in "${key}" (need ${min})`)
          requiredFixes.push(`Find at least ${min - len} more entries for "${key}"`)
          score -= 20
        }
      }
    } catch {
      problems.push('Invalid JSON artifact')
      requiredFixes.push(`Fix JSON syntax in ${artifact.path}`)
      score -= 40
    }
  }

  if (!artifact.body.trim()) {
    problems.push('Empty artifact')
    requiredFixes.push(`Write content to ${artifact.path}`)
    score = 0
  }

  score = Math.max(0, Math.min(100, score))
  return {
    passed: problems.length === 0,
    score,
    problems,
    requiredFixes,
  }
}

export function judgeTask(task: TaskRecord, artifacts: ArtifactRecord[]): JudgeVerdict {
  const expected = task.outputs
  const missing = expected.filter((path) => !artifacts.some((a) => a.path === path && a.body.trim()))
  if (missing.length) {
    return {
      passed: false,
      score: 0,
      problems: missing.map((p) => `Missing artifact: ${p}`),
      requiredFixes: missing.map((p) => `Write ${p}`),
    }
  }

  const verdicts = expected
    .map((path) => artifacts.find((a) => a.path === path))
    .filter((a): a is ArtifactRecord => !!a)
    .map((a) => judgeArtifact(task, a))

  if (!verdicts.length) {
    return { passed: false, score: 0, problems: ['No artifacts submitted'], requiredFixes: task.outputs.map((p) => `Write ${p}`) }
  }

  const problems = verdicts.flatMap((v) => v.problems)
  const requiredFixes = verdicts.flatMap((v) => v.requiredFixes)
  const score = Math.round(verdicts.reduce((s, v) => s + v.score, 0) / verdicts.length)
  return {
    passed: problems.length === 0,
    score,
    problems,
    requiredFixes,
  }
}
