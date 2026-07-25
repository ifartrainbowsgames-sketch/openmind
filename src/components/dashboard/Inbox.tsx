import { useEffect, useState } from 'react'
import { Send, Bot, UserCheck, CheckCircle2, Globe, Monitor, Clock } from 'lucide-react'
import { supabase } from '@/lib/supabase'

interface Msg { from: 'visitor' | 'ai' | 'me'; text: string; t: string }
type Status = 'ai' | 'human' | 'resolved'

interface Convo {
  id: string
  visitor: string
  loc: string
  device: string
  page: string
  started: string
  status: Status
  unread: boolean
  msgs: Msg[]
}

const SEED: Convo[] = [
  {
    id: 'c1', visitor: 'Visitor #4821', loc: 'Berlin, DE', device: 'Chrome · macOS', page: '/pricing',
    started: '2m ago', status: 'ai', unread: true,
    msgs: [
      { from: 'visitor', text: 'Hey — does the Pro plan include the chatbot widget?', t: '09:41' },
      { from: 'ai', text: 'Yes! The chatbot is included on every plan — Pro runs it on up to 5 sites.', t: '09:41' },
      { from: 'visitor', text: 'Nice. Can my team take over a conversation?', t: '09:42' },
    ],
  },
  {
    id: 'c2', visitor: 'Visitor #4820', loc: 'Austin, US', device: 'Safari · iOS', page: '/docs/embed',
    started: '11m ago', status: 'human', unread: true,
    msgs: [
      { from: 'visitor', text: 'The widget isn\'t loading on my Webflow site, I pasted the script in the head.', t: '09:30' },
      { from: 'ai', text: 'I can help with that. This is often a caching issue — could you try a hard refresh? Escalating to a human if it persists.', t: '09:31' },
      { from: 'me', text: 'Hi! Alex here. Can you share the page where this happened? I’ll take a look.', t: '09:33' },
      { from: 'visitor', text: 'Sure — acme-store.webflow.io', t: '09:35' },
    ],
  },
  {
    id: 'c3', visitor: 'Visitor #4814', loc: 'Lyon, FR', device: 'Firefox · Windows', page: '/',
    started: '28m ago', status: 'ai', unread: false,
    msgs: [
      { from: 'visitor', text: 'What\'s your refund policy?', t: '09:12' },
      { from: 'ai', text: 'According to our refund policy, you can return within 30 days of purchase, no questions asked. Want the full document?', t: '09:12' },
      { from: 'visitor', text: 'No that covers it, thanks!', t: '09:13' },
    ],
  },
  {
    id: 'c4', visitor: 'Visitor #4809', loc: 'Tokyo, JP', device: 'Chrome · Android', page: '/blog/byok',
    started: '1h ago', status: 'resolved', unread: false,
    msgs: [
      { from: 'visitor', text: 'セルフホスト版の要件は？', t: '08:31' },
      { from: 'ai', text: 'パッケージ化されたセルフホスト版は現在ロードマップ上にあり、まだ利用できません。', t: '08:31' },
    ],
  },
]

const STATUS_META: Record<Status, { label: string; cls: string }> = {
  ai: { label: 'Assistant', cls: 'border-emerald-600/50 text-emerald-700' },
  human: { label: 'You', cls: 'border-accent/60 text-accent' },
  resolved: { label: 'Resolved', cls: 'border-border/60 text-muted-foreground' },
}

export default function Inbox({ userId, demo }: { userId: string; demo: boolean }) {
  const [convos, setConvos] = useState<Convo[]>(demo ? SEED : [])
  const [activeId, setActiveId] = useState(demo ? 'c1' : '')
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(!demo)
  const [error, setError] = useState<string | null>(null)
  const convo = convos.find((c) => c.id === activeId) ?? convos[0]

  useEffect(() => {
    if (demo) return
    let live = true
    const load = async () => {
      const { data: rows, error: conversationError } = await supabase
        .from('conversations')
        .select('*')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false })
      if (!live) return
      if (conversationError) {
        setError(`Could not load conversations: ${conversationError.message}`)
        setLoading(false)
        return
      }
      const ids = (rows ?? []).map((row) => row.id)
      const { data: messages, error: messageError } = ids.length
        ? await supabase.from('messages').select('*').in('conversation_id', ids).order('created_at')
        : { data: [], error: null }
      if (!live) return
      if (messageError) {
        setError(`Could not load messages: ${messageError.message}`)
        setLoading(false)
        return
      }
      const next: Convo[] = (rows ?? []).map((row) => ({
        id: row.id,
        visitor: row.visitor ?? 'Website visitor',
        loc: row.location ?? 'Unknown',
        device: row.device ?? 'Web widget',
        page: row.page ?? '/',
        started: new Date(row.started_at).toLocaleString(),
        status: row.status === 'human' || row.status === 'resolved' ? row.status : 'ai',
        unread: Boolean(row.unread),
        msgs: (messages ?? [])
          .filter((message) => message.conversation_id === row.id)
          .map((message) => ({
            from: message.sender === 'visitor' ? 'visitor' as const : message.sender === 'ai' ? 'ai' as const : 'me' as const,
            text: message.text,
            t: new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          })),
      }))
      setConvos(next)
      setActiveId((current) => next.some((item) => item.id === current) ? current : next[0]?.id ?? '')
      setError(null)
      setLoading(false)
    }
    void load()
    const channel = supabase
      .channel(`inbox:${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations', filter: `user_id=eq.${userId}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter: `user_id=eq.${userId}` }, load)
      .subscribe()
    return () => {
      live = false
      void supabase.removeChannel(channel)
    }
  }, [userId, demo])

  const select = (id: string) => {
    setActiveId(id)
    setConvos((cs) => cs.map((c) => (c.id === id ? { ...c, unread: false } : c)))
  }

  const setStatus = (status: Status) => {
    setConvos((cs) => cs.map((c) => (c.id === activeId ? { ...c, status } : c)))
    if (!demo) void supabase.from('conversations').update({ status }).eq('id', activeId).eq('user_id', userId)
  }

  const send = async () => {
    const t = draft.trim()
    if (!t || !convo) return
    setConvos((cs) =>
      cs.map((c) =>
        c.id === activeId
          ? { ...c, status: 'human', msgs: [...c.msgs, { from: 'me' as const, text: t, t: 'now' }] }
          : c,
      ),
    )
    setDraft('')
    if (!demo) {
      const { error: sendError } = await supabase.from('messages').insert({
        conversation_id: convo.id,
        user_id: userId,
        sender: 'user',
        staff_user_id: userId,
        text: t,
      })
      if (sendError) setError(`Could not send reply: ${sendError.message}`)
      else await supabase.from('conversations').update({ status: 'human', unread: false }).eq('id', convo.id)
    }
  }

  const unread = convos.filter((c) => c.unread).length

  if (loading) {
    return <div className="border border-border/60 bg-card p-8 text-sm text-muted-foreground">Loading conversations…</div>
  }
  if (!convo) {
    return (
      <div className="space-y-5">
        <div>
          <h2 className="font-serif-display text-3xl font-semibold">Conversations</h2>
          <p className="mt-1 text-sm text-muted-foreground">Published widget conversations will appear here in real time.</p>
        </div>
        {error && <div role="alert" className="border border-red-600 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        <div className="border border-dashed border-border bg-card px-6 py-16 text-center text-sm text-muted-foreground">
          No customer conversations yet.
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {error && <div role="alert" className="border border-red-600 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="font-serif-display text-3xl font-semibold">Conversations</h2>
            <span className={`border px-2 py-1 font-mono-spec text-[9px] uppercase tracking-wider ${
              demo ? 'border-amber-600 text-amber-700' : 'border-emerald-700 text-emerald-700'
            }`}>
              {demo ? 'demo · sample conversations' : 'live · persisted widget conversations'}
            </span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Every customer conversation in one place. The assistant answers first, and your team can step in.
          </p>
        </div>
        <span className="font-mono-spec text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
          {unread} unread · {convos.filter((c) => c.status === 'ai').length} with assistant
        </span>
      </div>

      <div className="grid border border-primary bg-card hard-shadow lg:grid-cols-[300px_1fr] xl:grid-cols-[300px_1fr_240px]">
        {/* conversation list */}
        <div className="border-b border-primary lg:border-b-0 lg:border-r">
          <div className="border-b border-primary px-4 py-2.5">
            <span className="spec-label">conversations</span>
          </div>
          {convos.map((c) => (
            <button
              key={c.id}
              onClick={() => select(c.id)}
              className={`flex w-full flex-col gap-1 border-b border-border/40 px-4 py-3 text-left transition-colors last:border-b-0 ${
                activeId === c.id ? 'bg-secondary/70' : 'hover:bg-secondary/40'
              }`}
            >
              <div className="flex items-center gap-2">
                {c.unread && <span className="h-2 w-2 rounded-full bg-accent" />}
                <span className="text-sm font-medium">{c.visitor}</span>
                <span className="ml-auto font-mono-spec text-[10px] text-muted-foreground">{c.started}</span>
              </div>
              <span className="truncate text-xs text-muted-foreground">
                {c.msgs[c.msgs.length - 1]?.text ?? 'Waiting for the first message…'}
              </span>
              <div className="mt-0.5 flex items-center gap-2">
                <span className={`border px-1.5 py-0.5 font-mono-spec text-[9px] uppercase tracking-wider ${STATUS_META[c.status].cls}`}>
                  {STATUS_META[c.status].label}
                </span>
                <span className="font-mono-spec text-[10px] text-muted-foreground">{c.page}</span>
              </div>
            </button>
          ))}
        </div>

        {/* thread */}
        <div className="flex min-h-[480px] flex-col">
          <div className="flex flex-wrap items-center gap-2 border-b border-primary px-4 py-2.5">
            <span className="text-sm font-medium">{convo.visitor}</span>
            <span className={`border px-1.5 py-0.5 font-mono-spec text-[9px] uppercase tracking-wider ${STATUS_META[convo.status].cls}`}>
              {STATUS_META[convo.status].label}
            </span>
            <div className="ml-auto flex gap-2">
              {convo.status !== 'human' && convo.status !== 'resolved' && (
                <button onClick={() => setStatus('human')} className="flex items-center gap-1.5 border border-primary px-3 py-1.5 font-mono-spec text-[10px] uppercase tracking-wider hover:bg-primary hover:text-primary-foreground">
                  <UserCheck className="h-3 w-3" /> Take over
                </button>
              )}
              {convo.status === 'human' && (
                <button onClick={() => setStatus('ai')} className="flex items-center gap-1.5 border border-primary px-3 py-1.5 font-mono-spec text-[10px] uppercase tracking-wider hover:bg-primary hover:text-primary-foreground">
                  <Bot className="h-3 w-3" /> Hand back to assistant
                </button>
              )}
              {convo.status !== 'resolved' && (
                <button onClick={() => setStatus('resolved')} className="flex items-center gap-1.5 border border-emerald-700 px-3 py-1.5 font-mono-spec text-[10px] uppercase tracking-wider text-emerald-700 hover:bg-emerald-700 hover:text-white">
                  <CheckCircle2 className="h-3 w-3" /> Resolve
                </button>
              )}
            </div>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto bg-secondary/30 p-4">
            {convo.msgs.map((m, i) => (
              <div key={i} className={m.from === 'visitor' ? '' : 'text-right'}>
                <span
                  className={`inline-block max-w-[80%] border px-3 py-2 text-left text-sm ${
                    m.from === 'visitor'
                      ? 'border-border/60 bg-card'
                      : m.from === 'ai'
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-accent bg-accent text-white'
                  }`}
                >
                  {m.from !== 'visitor' && (
                    <span className="mb-0.5 flex items-center gap-1 font-mono-spec text-[9px] uppercase tracking-wider opacity-70">
                      {m.from === 'ai' ? <Bot className="h-2.5 w-2.5" /> : <UserCheck className="h-2.5 w-2.5" />}
                      {m.from === 'ai' ? 'Assistant' : 'You'}
                    </span>
                  )}
                  {m.text}
                </span>
                <div className="mt-0.5 font-mono-spec text-[9px] text-muted-foreground">{m.t}</div>
              </div>
            ))}
          </div>

          <div className="flex gap-2 border-t border-primary p-3">
            <input
              className="flex-1 border border-border/60 bg-background px-3 py-2.5 text-sm outline-none focus:border-accent rounded-none"
              placeholder={convo.status === 'resolved' ? 'Conversation resolved' : 'Reply as yourself — takes the conversation over…'}
              disabled={convo.status === 'resolved'}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && send()}
            />
            <button
              onClick={send}
              disabled={convo.status === 'resolved'}
              className="border border-primary bg-primary px-4 text-primary-foreground hover:bg-accent hover:border-accent disabled:opacity-40"
              aria-label="Send"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* visitor intel */}
        <div className="hidden border-l border-primary xl:block">
          <div className="border-b border-primary px-4 py-2.5">
            <span className="spec-label">visitor intel</span>
          </div>
          <div className="space-y-4 p-4 text-sm">
            {[
              { icon: Globe, k: 'Location', v: convo.loc },
              { icon: Monitor, k: 'Device', v: convo.device },
              { icon: Clock, k: 'On page', v: convo.page },
            ].map((r) => (
              <div key={r.k} className="flex items-start gap-3">
                <r.icon className="mt-0.5 h-4 w-4 text-accent" />
                <div>
                  <div className="spec-label">{r.k}</div>
                  <div className="mt-0.5">{r.v}</div>
                </div>
              </div>
            ))}
            <div className="border-t border-border/50 pt-3">
              <div className="spec-label mb-2">Journey</div>
              {['/blog/byok', '/pricing', convo.page].map((p, i) => (
                <div key={i} className="flex items-center gap-2 py-0.5 font-mono-spec text-[11px] text-muted-foreground">
                  <span className="text-accent">{i + 1}.</span> {p}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
