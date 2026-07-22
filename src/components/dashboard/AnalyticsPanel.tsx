import { useMemo, type CSSProperties } from 'react'
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'
import { hashSeed, mulberry } from '@/lib/demo'
import { PLAN_LIMITS, type Plan } from '@/hooks/usePlan'
import CountUp from '@/components/dash-fx/CountUp'
import { Eye, MessageSquare, Timer, MousePointerClick, Lock, Zap, TrendingUp, TrendingDown } from 'lucide-react'

interface DayPoint { day: string; visitors: number; chats: number }

/** Deterministic demo series — replaced by real events once the tracker is installed. */
function genSeries(days: number): DayPoint[] {
  const out: DayPoint[] = []
  const now = new Date()
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    const rnd = mulberry(hashSeed(d.toISOString().slice(0, 10)))
    const dow = d.getDay()
    const weekend = dow === 0 || dow === 6 ? 0.55 : 1
    const growth = 1 + (days - i) * 0.012
    const visitors = Math.round((90 + rnd() * 160) * weekend * growth)
    const chats = Math.round(visitors * (0.08 + rnd() * 0.1))
    out.push({
      day: d.toLocaleDateString('en', { month: 'short', day: 'numeric' }),
      visitors,
      chats,
    })
  }
  return out
}

const TOP_PAGES = [
  { page: '/pricing', views: 1184, clicks: 402, chats: 96, time: '2:41' },
  { page: '/', views: 2402, clicks: 631, chats: 188, time: '1:38' },
  { page: '/docs/getting-started', views: 866, clicks: 288, chats: 121, time: '4:12' },
  { page: '/blog/byok-explained', views: 540, clicks: 97, chats: 34, time: '3:05' },
  { page: '/changelog', views: 212, clicks: 44, chats: 9, time: '0:52' },
]

const LIVE_EVENTS = [
  'visitor from Berlin opened /pricing',
  'chat started on /docs/getting-started',
  'visitor from Austin clicked "Start free"',
  'visitor from Tokyo stayed 6:12 on /blog',
  'chat started on /',
  'visitor from Lyon left after 0:34',
]

function Delta({ v }: { v: number }) {
  const up = v >= 0
  return (
    <span className={`flex items-center gap-1 font-mono-spec text-[10px] uppercase tracking-wider ${up ? 'text-emerald-700' : 'text-accent'}`}>
      {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {up ? '+' : ''}{v}% vs last week
    </span>
  )
}

export default function AnalyticsPanel({ plan, onUpgrade }: { plan: Plan; onUpgrade: () => void }) {
  const days = PLAN_LIMITS[plan].analyticsDays
  const series = useMemo(() => genSeries(days), [days])
  const totals = useMemo(
    () => series.reduce((a, d) => ({ visitors: a.visitors + d.visitors, chats: a.chats + d.chats }), { visitors: 0, chats: 0 }),
    [series],
  )
  const conv = ((totals.chats / Math.max(1, totals.visitors)) * 100).toFixed(1)
  const liveNow = 3 + (new Date().getMinutes() % 5)

  const KPIS = [
    { icon: Eye, label: `Visitors · ${days}d`, value: totals.visitors.toLocaleString(), delta: 12, countTo: totals.visitors },
    { icon: MessageSquare, label: 'Chats started', value: totals.chats.toLocaleString(), delta: 18, countTo: totals.chats },
    { icon: MousePointerClick, label: 'Chat conversion', value: `${conv}%`, delta: 4, countTo: null as number | null },
    { icon: Timer, label: 'Avg. session', value: '2:38', delta: -3, countTo: null as number | null },
  ]

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <h2 className="font-serif-display text-3xl font-semibold">Analytics</h2>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Who visits, where they click, who chats and how long they stay.{' '}
            <span className="border border-amber-500/60 px-1.5 py-0.5 font-mono-spec text-[10px] uppercase tracking-wider text-amber-700">
              sample data — install the tracker to go live
            </span>
          </p>
        </div>
        <span className="flex items-center gap-2 border border-primary bg-card px-3 py-1.5 font-mono-spec text-[11px] uppercase tracking-[0.14em]">
          <span className="pulse-dot h-2 w-2 rounded-full bg-emerald-600" />
          {liveNow} on your site now
        </span>
      </div>

      {/* KPI row */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {KPIS.map((k, i) => (
          <div key={k.label} className="dash-cascade border border-primary bg-card p-4 hard-shadow-sm" style={{ '--dash-i': i } as CSSProperties}>
            <div className="flex items-center justify-between">
              <k.icon className="h-4 w-4 text-accent" />
              <Delta v={k.delta} />
            </div>
            <div className="mt-3 font-serif-display text-3xl font-semibold">
              {k.countTo === null ? k.value : <CountUp value={k.countTo} />}
            </div>
            <div className="spec-label mt-1">{k.label}</div>
          </div>
        ))}
      </div>

      {/* visitors chart */}
      <div className="dash-feed-in border border-primary bg-card hard-shadow">
        <div className="flex items-center justify-between border-b border-primary px-5 py-2.5">
          <span className="spec-label">Visitors — last {days} days</span>
          {plan === 'free' && (
            <span className="font-mono-spec text-[10px] uppercase tracking-wider text-muted-foreground">
              free plan keeps 7 days · pro keeps 90
            </span>
          )}
        </div>
        <div className="h-64 p-4">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid strokeDasharray="2 4" stroke="#17140f22" vertical={false} />
              <XAxis dataKey="day" tick={{ fontSize: 10, fontFamily: 'IBM Plex Mono' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 10, fontFamily: 'IBM Plex Mono' }} tickLine={false} axisLine={false} />
              <Tooltip
                contentStyle={{ background: '#17140f', border: 'none', borderRadius: 0, color: '#faf8f5', fontFamily: 'IBM Plex Mono', fontSize: 12 }}
                labelStyle={{ color: '#ff4d00' }}
              />
              <Area type="monotone" dataKey="visitors" stroke="#17140f" strokeWidth={1.5} fill="#ff4d00" fillOpacity={0.18}
                isAnimationActive animationDuration={700} animationEasing="ease-out" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {/* chats bar chart */}
        <div className="dash-feed-in border border-primary bg-card">
          <div className="border-b border-primary px-5 py-2.5">
            <span className="spec-label">Chats started per day</span>
          </div>
          <div className="h-52 p-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={series} margin={{ top: 4, right: 8, left: -24, bottom: 0 }}>
                <XAxis dataKey="day" tick={{ fontSize: 9, fontFamily: 'IBM Plex Mono' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 9, fontFamily: 'IBM Plex Mono' }} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{ background: '#17140f', border: 'none', borderRadius: 0, color: '#faf8f5', fontFamily: 'IBM Plex Mono', fontSize: 12 }}
                  labelStyle={{ color: '#ff4d00' }}
                />
                <Bar dataKey="chats" fill="#ff4d00" isAnimationActive animationDuration={600} animationEasing="ease-out" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* live feed */}
        <div className="dash-feed-in border border-primary bg-card">
          <div className="flex items-center justify-between border-b border-primary px-5 py-2.5">
            <span className="spec-label">Live — who comes in, who goes out</span>
            <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-accent" />
          </div>
          <div className="bg-terminal">
            {LIVE_EVENTS.map((e, i) => (
              <div key={e} className="dash-cascade flex items-center gap-3 border-b border-white/10 px-4 py-2.5 font-mono-spec text-[11px] text-white/75 last:border-b-0"
                style={{ '--dash-i': i } as CSSProperties}>
                <span className="text-white/30">{String(i + 1).padStart(2, '0')}</span>
                {e}
                <span className="ml-auto text-white/30">{i * 14 + 2}s ago</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* top pages */}
      <div className="relative border border-primary bg-card hard-shadow">
        <div className="border-b border-primary px-5 py-2.5">
          <span className="spec-label">Top pages — views, clicks, chats</span>
        </div>
        <div data-lenis-prevent className={`overflow-x-auto ${plan === 'free' ? 'select-none blur-[3px]' : ''}`}>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border/50">
                {['Page', 'Views', 'Clicks', 'Chats', 'Avg. time'].map((h) => (
                  <th key={h} className="spec-label px-5 py-2.5 font-normal">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {TOP_PAGES.map((p) => (
                <tr key={p.page} className="border-b border-border/30 last:border-b-0">
                  <td className="px-5 py-2.5 font-mono-spec text-[12px]">{p.page}</td>
                  <td className="px-5 py-2.5">{p.views.toLocaleString()}</td>
                  <td className="px-5 py-2.5">{p.clicks}</td>
                  <td className="px-5 py-2.5">{p.chats}</td>
                  <td className="px-5 py-2.5 text-muted-foreground">{p.time}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {plan === 'free' && (
          <div className="absolute inset-0 top-10 flex items-center justify-center">
            <div className="border border-primary bg-card px-6 py-5 text-center hard-shadow">
              <Lock className="mx-auto mb-2 h-5 w-5 text-accent" />
              <p className="font-mono-spec text-[11px] uppercase tracking-[0.14em]">
                Page-level analytics is a Pro feature
              </p>
              <button
                onClick={onUpgrade}
                className="mt-3 flex items-center gap-1.5 border border-accent bg-accent px-4 py-2 font-mono-spec text-[10px] uppercase tracking-[0.14em] text-white hover:bg-accent/85"
              >
                <Zap className="h-3 w-3" /> Unlock with Pro — $10/mo
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
