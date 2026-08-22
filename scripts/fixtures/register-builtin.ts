/**
 * Register the builtin runtime for a script.
 *
 * `task-runner` constructs the builtin runtime itself when no `runtimeId` is
 * given, so most runs need nothing here. This exists for scripts that want the
 * registry populated — and to keep the `runtimeFor()` hard-failure rule
 * intact rather than having each script invent its own fallback.
 */

import { registerRuntime, listRuntimes } from '../../src/lib/workforce/agent-runtime'
import { createBuiltinRuntime } from '../../src/lib/workforce/builtin-runtime'

export function registerBuiltin(): void {
  if (listRuntimes().some((r) => r.id === 'builtin')) return
  registerRuntime(createBuiltinRuntime({
    brain: { plan: async () => [], respond: async () => '' },
    employeeFor: () => ({
      id: 'placeholder', name: 'Placeholder', role: 'placeholder',
      prompt: '', tools: [], accent: '#000',
    }),
    promptFor: () => '',
  }))
}
