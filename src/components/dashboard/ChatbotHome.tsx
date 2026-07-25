import { Power } from 'lucide-react'
import type { ChatbotConfig } from '@/lib/chatbot-config'
import type { StaffMember } from '@/lib/staff'
import AvailabilitySwitch from './AvailabilitySwitch'

interface Props {
  config: ChatbotConfig
  published: boolean
  sourceCount: number
  staff: StaffMember[]
  onAvailability: (enabled: boolean) => void
  onNavigate: (view: string) => void
}

export default function ChatbotHome({ config, published, sourceCount, staff, onAvailability, onNavigate }: Props) {
  const availableStaff = staff.filter((member) => member.status === 'active' && member.available)
  const checks = [
    {
      label: 'Replies',
      value: config.selectedEmployeeName ?? 'Standard assistant',
      ready: Boolean(config.selectedEmployeeName || config.systemPrompt.trim()),
      action: 'settings',
    },
    { label: 'Knowledge sources', value: `${sourceCount} attached`, ready: sourceCount > 0, action: 'knowledge' },
    { label: 'Team', value: `${availableStaff.length} available`, ready: availableStaff.length > 0, action: 'team' },
    { label: 'Website chatbot', value: published ? 'Published' : 'Draft', ready: published, action: 'chatbot' },
  ]

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="font-serif-display text-3xl font-semibold">Your chatbot</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            See what is ready and choose the next step.
          </p>
        </div>
        <div className={`flex items-center gap-4 border px-4 py-3 ${
          config.enabled ? 'border-emerald-700 bg-emerald-50' : 'border-border bg-card'
        }`}>
          <div>
            <div className="flex items-center gap-2 text-sm font-medium">
              <Power className={`h-4 w-4 ${config.enabled ? 'text-emerald-700' : 'text-muted-foreground'}`} />
              Customer chatbot
            </div>
            <div className="font-mono-spec text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
              {config.enabled ? 'available on published sites' : 'offline message only'}
            </div>
          </div>
          <AvailabilitySwitch
            checked={config.enabled}
            onChange={onAvailability}
            label="Customer chatbot availability"
          />
        </div>
      </div>

      <div className="grid border-l border-t border-primary sm:grid-cols-2 lg:grid-cols-4">
        {checks.map((check) => (
          <button
            key={check.label}
            onClick={() => onNavigate(check.action)}
            className="border-b border-r border-primary bg-card p-5 text-left transition-colors hover:bg-secondary"
          >
            <div className="flex items-center justify-between">
              <span className="spec-label">{check.label}</span>
              <span className={`h-2 w-2 rounded-full ${check.ready ? 'bg-emerald-600' : 'bg-amber-500'}`} />
            </div>
            <div className="mt-2 font-serif-display text-2xl font-semibold">{check.value}</div>
            <div className="mt-1 font-mono-spec text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
              {check.ready ? 'Ready' : 'Set up'} · Open
            </div>
          </button>
        ))}
      </div>

    </div>
  )
}
