import { useMemo } from 'react'
import { Bot, Database, Globe2, Save, ShieldCheck } from 'lucide-react'
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
        <h2 className="font-serif-display text-3xl font-semibold">Behavior & routing</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Publish one behavior profile for the customer chatbot. Selecting an AI employee sends that employee's prompt
          through the server-side chat gateway; browser-only connection plugins are not exposed to visitors.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-5">
          <div className="border border-primary bg-card p-5">
            <span className="spec-label mb-4 flex items-center gap-2">
              <Bot className="h-3.5 w-3.5" /> AI employee handling customer chat
            </span>
            <select
              className={inputCls}
              aria-label="Customer chatbot AI employee"
              value={config.selectedEmployeeId ?? ''}
              onChange={(event) => selectEmployee(event.target.value)}
            >
              <option value="">Default chatbot behavior</option>
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.name} — {employee.role}
                </option>
              ))}
            </select>
            <p className="mt-2 text-xs text-muted-foreground">
              {config.selectedEmployeeName
                ? `${config.selectedEmployeeName} is connected to public customer conversations after you save.`
                : 'Choose an employee or use the default chatbot prompt below.'}
            </p>
          </div>

          <div className="border border-primary bg-card p-5">
            <label className="block">
              <span className="spec-label mb-2 block">Default system prompt</span>
              <textarea
                className={`${inputCls} min-h-36 resize-y font-mono-spec text-[12px] leading-relaxed`}
                value={config.systemPrompt}
                onChange={(event) => onChange({ systemPrompt: event.target.value })}
              />
            </label>
            {config.selectedEmployeePrompt && (
              <div className="mt-4 border border-border/60 bg-secondary/40 p-3">
                <span className="spec-label mb-1 block">Published employee prompt</span>
                <p className="max-h-28 overflow-y-auto whitespace-pre-wrap font-mono-spec text-[11px] leading-relaxed text-muted-foreground">
                  {config.selectedEmployeePrompt}
                </p>
              </div>
            )}
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
              sources attached to Chatbot · stored source content is available to the gateway; full semantic indexing remains separate.
            </p>
          </div>

          <div className="border border-primary bg-card p-5">
            <label className="block">
              <span className="spec-label mb-2 flex items-center gap-2">
                <Globe2 className="h-3.5 w-3.5" /> Allowed website origins
              </span>
              <textarea
                className={`${inputCls} min-h-28 resize-y font-mono-spec text-[12px]`}
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
              Empty uses the deployment-wide origin allowlist. Add production domains before publishing customer embeds.
            </p>
          </div>

          <div className="border border-emerald-700/50 bg-emerald-50 p-4 text-emerald-900">
            <div className="flex items-center gap-2 text-sm font-medium">
              <ShieldCheck className="h-4 w-4" /> Public-chat safety boundary
            </div>
            <p className="mt-1 text-xs leading-relaxed">
              Customer chat receives the selected employee prompt, not session-only MCP, n8n, or OpenClaw credentials.
              External write tools stay console-only until a server vault and tool policy are available.
            </p>
          </div>

          <button
            onClick={() => void onSave()}
            disabled={saving}
            className="flex w-full items-center justify-center gap-2 border border-primary bg-primary px-5 py-3 font-mono-spec text-[11px] uppercase tracking-[0.15em] text-primary-foreground hover:bg-accent disabled:opacity-50"
          >
            <Save className="h-3.5 w-3.5" />
            {saving
              ? 'Saving…'
              : saved
              ? published ? '✓ Behavior published' : '✓ Behavior saved locally'
              : published ? 'Save & publish behavior' : 'Save behavior locally'}
          </button>
        </div>
      </div>
    </div>
  )
}
