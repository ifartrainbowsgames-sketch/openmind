import { useEffect, useState } from 'react'
import { Bell, MessageCircle, PhoneCall, Plus, Send, Trash2, Users } from 'lucide-react'
import AvailabilitySwitch from './AvailabilitySwitch'
import type { StaffMember } from '@/lib/staff'

interface Props {
  members: StaffMember[]
  seatLimit: number
  onAdd: (name: string, email: string) => Promise<boolean>
  onUpdate: (member: StaffMember) => Promise<boolean>
  onRemove: (member: StaffMember) => Promise<boolean>
}

function SettingRow({
  title,
  note,
  checked,
  onChange,
  disabled,
}: {
  title: string
  note: string
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border/40 py-2.5 last:border-b-0">
      <div>
        <div className="text-sm font-medium">{title}</div>
        <div className="text-[11px] text-muted-foreground">{note}</div>
      </div>
      <AvailabilitySwitch checked={checked} onChange={onChange} label={title} disabled={disabled} />
    </div>
  )
}

function StaffCard({
  member,
  onUpdate,
  onRemove,
}: {
  member: StaffMember
  onUpdate: (member: StaffMember) => Promise<boolean>
  onRemove: (member: StaffMember) => Promise<boolean>
}) {
  const [telegramChatId, setTelegramChatId] = useState(member.telegramChatId)
  const [whatsappPhone, setWhatsappPhone] = useState(member.whatsappPhone)
  const [saved, setSaved] = useState(false)
  const telegramBot = (import.meta.env.VITE_TELEGRAM_BOT_USERNAME as string | undefined)?.replace(/^@/, '')
  const telegramLink = telegramBot && member.telegramLinkCode
    ? `https://t.me/${telegramBot}?start=${encodeURIComponent(member.telegramLinkCode)}`
    : ''
  const patch = (values: Partial<StaffMember>) => void onUpdate({ ...member, ...values })
  useEffect(() => {
    void Promise.resolve().then(() => {
      setTelegramChatId(member.telegramChatId)
      setWhatsappPhone(member.whatsappPhone)
    })
  }, [member.telegramChatId, member.whatsappPhone])
  const saveTargets = async () => {
    const ok = await onUpdate({
      ...member,
      telegramChatId: telegramChatId.trim(),
      whatsappPhone: whatsappPhone.trim(),
      notifyTelegram: telegramChatId.trim() ? member.notifyTelegram : false,
      notifyWhatsapp: whatsappPhone.trim() ? member.notifyWhatsapp : false,
    })
    if (ok) {
      setSaved(true)
      setTimeout(() => setSaved(false), 1400)
    }
  }

  return (
    <div className="border border-primary bg-card">
      <div className="flex items-start justify-between gap-3 border-b border-primary px-4 py-3">
        <div>
          <div className="font-serif-display text-lg font-semibold">{member.name}</div>
          <div className="font-mono-spec text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            {member.role} · {member.email}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`border px-2 py-1 font-mono-spec text-[9px] uppercase tracking-[0.12em] ${
            member.available ? 'border-emerald-700 text-emerald-700' : 'border-border text-muted-foreground'
          }`}>
            {member.available ? 'available' : 'offline'}
          </span>
          {member.role !== 'owner' && (
            <button
              onClick={() => void onRemove(member)}
              className="p-1.5 text-muted-foreground hover:text-red-600"
              aria-label={`Remove ${member.name}`}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="grid gap-4 p-4 lg:grid-cols-2">
        <div>
          <span className="spec-label mb-1 block">Routing availability</span>
          <SettingRow
            title="Available"
            note="Include this person in new conversation routing"
            checked={member.available}
            onChange={(available) => patch({ available })}
          />
          <SettingRow
            title="Accept text conversations"
            note="Receive new chat and takeover alerts"
            checked={member.acceptTexts}
            onChange={(acceptTexts) => patch({ acceptTexts })}
            disabled={!member.available}
          />
          <SettingRow
            title="Accept call requests"
            note="Receive callback requests; audio requires a telephony provider"
            checked={member.acceptCalls}
            onChange={(acceptCalls) => patch({ acceptCalls })}
            disabled={!member.available}
          />
          <SettingRow
            title="Dashboard popups"
            note="Show the workspace owner a live console notification"
            checked={member.notifyDashboard}
            onChange={(notifyDashboard) => patch({ notifyDashboard })}
          />
        </div>

        <div>
          <span className="spec-label mb-2 block">Notification channels</span>
          <label className="mb-2 block">
            <span className="mb-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Send className="h-3 w-3" /> Telegram chat ID
            </span>
            <input
              className="w-full border border-border/60 bg-background px-3 py-2 text-sm outline-none focus:border-accent"
              placeholder="e.g. 123456789"
              value={telegramChatId}
              onChange={(event) => setTelegramChatId(event.target.value)}
            />
          </label>
          {telegramLink ? (
            <a
              href={telegramLink}
              target="_blank"
              rel="noreferrer"
              className="mb-2 inline-flex items-center gap-1.5 font-mono-spec text-[9px] uppercase tracking-[0.12em] text-accent underline underline-offset-4"
            >
              <Send className="h-3 w-3" /> Connect automatically in Telegram
            </a>
          ) : (
            <p className="mb-2 text-[10px] leading-relaxed text-muted-foreground">
              Set VITE_TELEGRAM_BOT_USERNAME to show the one-click Telegram connection link.
            </p>
          )}
          <SettingRow
            title="Telegram alerts"
            note="Uses the platform bot configured on the server"
            checked={member.notifyTelegram}
            onChange={(notifyTelegram) => patch({ notifyTelegram, telegramChatId: telegramChatId.trim() })}
            disabled={!telegramChatId.trim()}
          />
          <label className="mb-2 mt-3 block">
            <span className="mb-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <MessageCircle className="h-3 w-3" /> WhatsApp number
            </span>
            <input
              className="w-full border border-border/60 bg-background px-3 py-2 text-sm outline-none focus:border-accent"
              placeholder="+491234567890"
              value={whatsappPhone}
              onChange={(event) => setWhatsappPhone(event.target.value)}
            />
          </label>
          <SettingRow
            title="WhatsApp alerts"
            note="Requires an approved Meta notification template"
            checked={member.notifyWhatsapp}
            onChange={(notifyWhatsapp) => patch({ notifyWhatsapp, whatsappPhone: whatsappPhone.trim() })}
            disabled={!whatsappPhone.trim()}
          />
          <button
            onClick={() => void saveTargets()}
            className="mt-3 w-full border border-primary bg-primary px-3 py-2 font-mono-spec text-[10px] uppercase tracking-[0.14em] text-primary-foreground hover:bg-accent"
          >
            {saved ? '✓ Notification targets saved' : 'Save notification targets'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function StaffSettings({ members, seatLimit, onAdd, onUpdate, onRemove }: Props) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [adding, setAdding] = useState(false)
  const atLimit = members.length >= seatLimit
  const add = async () => {
    if (!name.trim() || !email.trim() || adding || atLimit) return
    setAdding(true)
    const ok = await onAdd(name, email)
    setAdding(false)
    if (ok) {
      setName('')
      setEmail('')
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-serif-display text-3xl font-semibold">Staff & availability</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Route customer texts and callback requests to people who are available, then notify them in the dashboard,
            Telegram, or WhatsApp.
          </p>
        </div>
        <span className="flex items-center gap-2 border border-border/60 px-3 py-1.5 font-mono-spec text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          <Users className="h-3.5 w-3.5" /> {members.length} / {seatLimit} seats
        </span>
      </div>

      <div className="border border-primary bg-card p-5">
        <span className="spec-label mb-3 block">Add company staff</span>
        <div className="grid gap-3 sm:grid-cols-[1fr_1.3fr_auto]">
          <input
            className="border border-border/60 bg-background px-3 py-2.5 text-sm outline-none focus:border-accent"
            placeholder="Name"
            aria-label="Staff name"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <input
            className="border border-border/60 bg-background px-3 py-2.5 text-sm outline-none focus:border-accent"
            placeholder="name@company.com"
            aria-label="Staff email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <button
            onClick={() => void add()}
            disabled={atLimit || adding || !name.trim() || !email.trim()}
            className="flex items-center justify-center gap-2 border border-primary bg-primary px-4 py-2.5 font-mono-spec text-[10px] uppercase tracking-[0.14em] text-primary-foreground hover:bg-accent disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" /> {adding ? 'Adding…' : 'Add staff'}
          </button>
        </div>
        {atLimit && (
          <p className="mt-2 text-xs text-amber-700">Seat limit reached for this plan.</p>
        )}
      </div>

      <div className="grid gap-4">
        {members.map((member) => (
          <StaffCard key={member.id} member={member} onUpdate={onUpdate} onRemove={onRemove} />
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="border border-border/60 bg-card p-4">
          <Bell className="mb-2 h-4 w-4 text-accent" />
          <div className="text-sm font-medium">Dashboard</div>
          <p className="mt-1 text-xs text-muted-foreground">Real-time popups reach the signed-in workspace owner; staff login invitations are not active yet.</p>
        </div>
        <div className="border border-border/60 bg-card p-4">
          <Send className="mb-2 h-4 w-4 text-accent" />
          <div className="text-sm font-medium">Telegram</div>
          <p className="mt-1 text-xs text-muted-foreground">Requires the server-only TELEGRAM_BOT_TOKEN secret.</p>
        </div>
        <div className="border border-border/60 bg-card p-4">
          <PhoneCall className="mb-2 h-4 w-4 text-accent" />
          <div className="text-sm font-medium">WhatsApp</div>
          <p className="mt-1 text-xs text-muted-foreground">Requires Meta Cloud API credentials and an approved template.</p>
        </div>
      </div>
    </div>
  )
}
