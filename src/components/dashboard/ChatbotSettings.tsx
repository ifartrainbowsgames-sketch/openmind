import { useMemo } from 'react'
import { Bot, Database, Globe2, Save } from 'lucide-react'
import { loadCustomEmployees, PRESET_EMPLOYEES } from '@/data/employees'
import type { ChatbotConfig } from '@/lib/chatbot-config'
import type { Source } from './types'

interface Props {
  config: ChatbotConfig
  sources: Source[]
  saving: boolean
  saved: boolean
  published: boolean
  onChange: (patch: Partial<ChatbotConfig>) => void
  onSave: () => Promise<boolean>
}

const inputCls =
  'w-full border border-border/60 bg-background px-3 py-2.5 text-sm outline-none focus:border-accent'

export default function ChatbotSettings({ config, sources, saving, saved, published, onChange, onSave }: Props) {
  const employees = useMemo(() => [...PRESET_EMPLOYEES, ...loadCustomEmployees()], [])
  const attached = sources.filter((source) => source.attached.includes('chat'))
  const selectEmployee = (id: string) => {
    const employee = employees.find((item) => item.id === id)
    if (!employee) {
      onChange({
        selectedEmployeeId: undefined,
        selectedEmployeeName: undefined,
        selectedEmployeePrompt: undefined,
      })
      return
    }
    onChange({
      selectedEmployeeId: employee.id,
      selectedEmployeeName: employee.name,
      selectedEmployeePrompt: employee.prompt,
      agentName: employee.name,
      widget: { ...config.widget, agentName: employee.name },
    })
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-serif-display text-3xl font-semibold">Chatbot settings</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Choose how your chatbot answers and what visitors see when your team is unavailable.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-5">
          <div className="border border-primary bg-card p-5">
            <span className="spec-label mb-4 flex items-center gap-2">
              <Bot className="h-3.5 w-3.5" /> Reply assistant
            </span>
            <select
              className={inputCls}
              aria-label="Customer chatbot reply assistant"
              value={config.selectedEmployeeId ?? ''}
              onChange={(event) => selectEmployee(event.target.value)}
            >
              <option value="">Standard assistant</option>
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.name} — {employee.role}
                </option>
              ))}
            </select>
            <p className="mt-2 text-xs text-muted-foreground">
              {config.selectedEmployeeName
                ? `${config.selectedEmployeeName} will answer new customer conversations.`
                : 'Use the standard assistant or choose an automation you created.'}
            </p>
          </div>

          <div className="border border-primary bg-card p-5">
            <label className="block">
              <span className="spec-label mb-2 block">Reply instructions</span>
              <textarea
                className={`${inputCls} min-h-36 resize-y text-sm leading-relaxed`}
                value={config.systemPrompt}
                onChange={(event) => onChange({ systemPrompt: event.target.value })}
              />
            </label>
          </div>

          <div className="border border-primary bg-card p-5">
            <label className="block">
              <span className="spec-label mb-2 block">Offline message</span>
              <textarea
                className={`${inputCls} min-h-20 resize-y`}
                value={config.offlineMessage}
                onChange={(event) => onChange({ offlineMessage: event.target.value })}
              />
            </label>
          </div>
        </div>

        <div className="space-y-5">
          <div className="border border-primary bg-card p-5">
            <span className="spec-label mb-3 flex items-center gap-2">
              <Database className="h-3.5 w-3.5" /> Knowledge readiness
            </span>
            <div className="font-serif-display text-4xl font-semibold">{attached.length}</div>
            <p className="mt-1 text-xs text-muted-foreground">
              knowledge sources available to customer replies
            </p>
          </div>

          <details className="border border-border/60 bg-card p-5">
            <summary className="cursor-pointer list-none spec-label flex items-center gap-2">
              <Globe2 className="h-3.5 w-3.5" /> Website access
            </summary>
            <label className="mt-4 block">
              <span className="spec-label mb-2 flex items-center gap-2">
                Allowed domains
              </span>
              <textarea
                className={`${inputCls} min-h-28 resize-y text-sm`}
                placeholder={'https://example.com\nhttps://www.example.com'}
                value={config.allowedOrigins.join('\n')}
                onChange={(event) =>
                  onChange({
                    allowedOrigins: event.target.value
                      .split(/\r?\n/)
                      .map((origin) => origin.trim())
                      .filter(Boolean),
                  })
                }
              />
            </label>
            <p className="mt-2 text-xs text-muted-foreground">
              Add each website where this chatbot may appear.
            </p>
          </details>

          <button
            onClick={() => void onSave()}
            disabled={saving}
            className="flex w-full items-center justify-center gap-2 border border-primary bg-primary px-5 py-3 font-mono-spec text-[11px] uppercase tracking-[0.15em] text-primary-foreground hover:bg-accent disabled:opacity-50"
          >
            <Save className="h-3.5 w-3.5" />
            {saving
              ? 'Saving…'
              : saved
              ? published ? '✓ Settings saved' : '✓ Saved in this browser'
              : 'Save settings'}
          </button>
        </div>
      </div>
    </div>
  )
}
