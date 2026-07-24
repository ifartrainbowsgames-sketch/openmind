import { Bot, Database, Inbox, Paintbrush, Power, Users } from 'lucide-react'
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
      label: 'AI handler',
      value: config.selectedEmployeeName ?? 'Default chatbot',
      ready: Boolean(config.selectedEmployeeName || config.systemPrompt.trim()),
      action: 'behavior',
    },
    { label: 'Knowledge sources', value: `${sourceCount} attached`, ready: sourceCount > 0, action: 'knowledge' },
    { label: 'Available staff', value: `${availableStaff.length} online`, ready: availableStaff.length > 0, action: 'staff' },
    { label: 'Widget key', value: published ? 'Issued' : 'Not published', ready: published, action: 'appearance' },
  ]

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="font-serif-display text-3xl font-semibold">Chatbot home</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            One operational view for customer chat, AI handling, human handoff, knowledge, and deployment.
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
              {check.ready ? 'ready' : 'needs setup'} · open
            </div>
          </button>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {[
          { id: 'inbox', label: 'Conversations', note: 'Take over customer chats', icon: Inbox },
          { id: 'behavior', label: 'AI behavior', note: 'Connect an AI employee', icon: Bot },
          { id: 'knowledge', label: 'Knowledge', note: 'Manage chatbot sources', icon: Database },
          { id: 'appearance', label: 'Widget', note: 'Brand and publish', icon: Paintbrush },
          { id: 'staff', label: 'Staff routing', note: 'Availability and alerts', icon: Users },
        ].map((item) => (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            className="border border-border/60 bg-card p-4 text-left transition-colors hover:border-primary hover:bg-secondary"
          >
            <item.icon className="mb-3 h-5 w-5 text-accent" />
            <div className="text-sm font-medium">{item.label}</div>
            <div className="mt-1 text-xs text-muted-foreground">{item.note}</div>
          </button>
        ))}
      </div>

      <div className="border border-primary bg-terminal p-5 text-white">
        <span className="font-mono-spec text-[10px] uppercase tracking-[0.16em] text-accent">Live routing model</span>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-white/75">
          Website message → selected AI employee prompt → persisted conversation → available staff assignment →
          dashboard, Telegram, or WhatsApp alert. Call buttons create callback requests until a telephony provider is connected.
        </p>
      </div>
    </div>
  )
}
