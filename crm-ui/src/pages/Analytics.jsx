import { useEffect, useState } from 'react'
import {
  BarChart2, TrendingUp, Mail, MousePointer, MessageSquare,
  AlertTriangle, UserX, RefreshCw, Clock, Calendar,
  ChevronDown, ChevronUp, Award, Zap,
} from 'lucide-react'

// ── Helpers ────────────────────────────────────────────────────────────────────
function pct(n) { return `${n ?? 0}%` }
function fmt(n)  { return (n ?? 0).toLocaleString() }
function rateColor(r) {
  if (r >= 40) return '#10b981'
  if (r >= 20) return '#f59e0b'
  if (r >= 10) return '#f97316'
  return '#ef4444'
}
function bounceColor(r) {
  if (r <= 2)  return '#10b981'
  if (r <= 5)  return '#f59e0b'
  return '#ef4444'
}

const HOURS = Array.from({ length: 24 }, (_, h) => {
  const suffix = h < 12 ? 'am' : 'pm'
  const h12    = h === 0 ? 12 : h > 12 ? h - 12 : h
  return `${h12}${suffix}`
})
const DAYS_FULL = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']

// ── Mini bar chart component ────────────────────────────────────────────────
function MiniBar({ value, max, color = '#6366f1', label, count }) {
  const pctVal = max > 0 ? Math.round(value / max * 100) : 0
  return (
    <div className="flex items-center gap-2 group">
      <span className="text-[10px] text-slate-500 w-10 text-right flex-shrink-0">{label}</span>
      <div className="flex-1 h-4 bg-slate-100 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pctVal}%`, background: color, minWidth: value > 0 ? '4px' : '0' }}
        />
      </div>
      <span className="text-[10px] font-bold text-slate-600 w-7 flex-shrink-0">{count}</span>
    </div>
  )
}

// ── Stat card ──────────────────────────────────────────────────────────────
function StatCard({ icon: Icon, label, value, sub, color = '#6366f1' }) {
  return (
    <div className="bg-white rounded-2xl p-4 border border-slate-200 flex items-start gap-3"
         style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
      <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
           style={{ background: color + '20' }}>
        <Icon size={17} style={{ color }} />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-slate-500 font-medium">{label}</p>
        <p className="text-xl font-bold text-slate-900 leading-tight">{value}</p>
        {sub && <p className="text-[11px] text-slate-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

// ── Rate pill ──────────────────────────────────────────────────────────────
function RatePill({ rate, isBounce }) {
  const color = isBounce ? bounceColor(rate) : rateColor(rate)
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold"
          style={{ background: color + '18', color }}>
      {rate}%
    </span>
  )
}

// ── Main Analytics Page ────────────────────────────────────────────────────
export default function Analytics() {
  const [data,       setData]       = useState(null)
  const [timeData,   setTimeData]   = useState(null)
  const [loading,    setLoading]    = useState(true)
  const [timeLoad,   setTimeLoad]   = useState(true)
  const [sort,       setSort]       = useState({ col: 'lastSentAt', dir: 'desc' })
  const [expanded,   setExpanded]   = useState(null)

  const token = localStorage.getItem('crm_token') || ''
  const headers = token ? { Authorization: `Bearer ${token}` } : {}

  async function load() {
    setLoading(true)
    try {
      const r = await fetch('/api/analytics', { headers })
      const d = await r.json()
      setData(d)
    } catch {}
    setLoading(false)
  }

  async function loadTime() {
    setTimeLoad(true)
    try {
      const r = await fetch('/api/send-time-stats', { headers })
      const d = await r.json()
      setTimeData(d)
    } catch {}
    setTimeLoad(false)
  }

  useEffect(() => { load(); loadTime() }, [])

  function toggleSort(col) {
    setSort(s => s.col === col
      ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' }
      : { col, dir: 'desc' }
    )
  }

  const campaigns = data?.campaigns ?? []
  const totals    = data?.totals    ?? {}

  const sorted = [...campaigns].sort((a, b) => {
    let av = a[sort.col] ?? 0, bv = b[sort.col] ?? 0
    if (typeof av === 'string') av = av.toLowerCase()
    if (typeof bv === 'string') bv = bv.toLowerCase()
    return sort.dir === 'asc' ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1)
  })

  // Best subject lines (by open rate, min 5 sends)
  const bestSubjects = [...campaigns]
    .filter(c => c.sent >= 5 && c.subjectPreview)
    .sort((a, b) => b.openRate - a.openRate)
    .slice(0, 5)

  const overallOpenRate  = totals.sent > 0 ? Math.round(totals.uniqueOpens  / totals.sent * 100) : 0
  const overallClickRate = totals.sent > 0 ? Math.round(totals.uniqueClicks / totals.sent * 100) : 0
  const overallReplyRate = totals.sent > 0 ? Math.round(totals.replies      / totals.sent * 100) : 0

  // Send time chart data
  const byHour   = timeData?.byHour   ?? []
  const byDow    = timeData?.byDow    ?? []
  const maxHour  = Math.max(...byHour.map(h => h.opens), 1)
  const maxDow   = Math.max(...byDow.map(d => d.opens),  1)
  const bestSlot = timeData?.bestSlot

  function SortIcon({ col }) {
    if (sort.col !== col) return <ChevronDown size={11} className="text-slate-300" />
    return sort.dir === 'asc'
      ? <ChevronUp size={11} className="text-indigo-500" />
      : <ChevronDown size={11} className="text-indigo-500" />
  }

  function Th({ col, children, right }) {
    return (
      <th
        className={`px-3 py-2.5 text-[10px] font-bold text-slate-500 uppercase tracking-wider cursor-pointer select-none hover:text-indigo-600 transition-colors ${right ? 'text-right' : 'text-left'}`}
        onClick={() => toggleSort(col)}
      >
        <span className="inline-flex items-center gap-1">
          {children}<SortIcon col={col} />
        </span>
      </th>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Campaign Analytics</h1>
          <p className="text-sm text-slate-500 mt-0.5">Open rates, click rates, reply rates and send time insights</p>
        </div>
        <button
          onClick={() => { load(); loadTime() }}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-slate-700 bg-white border border-slate-200 hover:border-indigo-300 hover:text-indigo-600 transition-all"
          style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Overall stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard icon={Mail}          label="Total Sent"    value={fmt(totals.sent)}         color="#6366f1" />
        <StatCard icon={TrendingUp}    label="Open Rate"     value={pct(overallOpenRate)}      sub={`${fmt(totals.uniqueOpens)} opened`}  color="#10b981" />
        <StatCard icon={MousePointer}  label="Click Rate"    value={pct(overallClickRate)}     sub={`${fmt(totals.uniqueClicks)} clicked`} color="#f59e0b" />
        <StatCard icon={MessageSquare} label="Reply Rate"    value={pct(overallReplyRate)}     sub={`${fmt(totals.replies)} replied`}     color="#3b82f6" />
        <StatCard icon={AlertTriangle} label="Bounces"       value={fmt(totals.bounces)}       color="#ef4444" />
        <StatCard icon={UserX}         label="Unsubscribes"  value={fmt(totals.unsubscribes)}  color="#8b5cf6" />
      </div>

      {/* Two-column: Best subjects + Send time */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Best performing subjects */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5"
             style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
          <div className="flex items-center gap-2 mb-4">
            <Award size={16} className="text-amber-500" />
            <h2 className="text-sm font-bold text-slate-800">Best Performing Subject Lines</h2>
            <span className="text-[10px] text-slate-400 ml-1">by open rate (min 5 sends)</span>
          </div>
          {bestSubjects.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-6">Not enough data yet — send more campaigns!</p>
          ) : (
            <div className="space-y-3">
              {bestSubjects.map((c, i) => (
                <div key={c.id} className="flex items-start gap-3">
                  <span className="text-[11px] font-bold w-5 text-center mt-0.5"
                        style={{ color: i === 0 ? '#f59e0b' : i === 1 ? '#94a3b8' : '#cd7c2f' }}>
                    #{i+1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-semibold text-slate-700 truncate" title={c.subjectPreview}>
                      {c.subjectPreview}
                    </p>
                    <p className="text-[10px] text-slate-400">{c.name} · {c.sent} sent</p>
                  </div>
                  <RatePill rate={c.openRate} />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Send Time Optimization */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5"
             style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
          <div className="flex items-center gap-2 mb-1">
            <Zap size={16} className="text-indigo-500" />
            <h2 className="text-sm font-bold text-slate-800">Best Send Times</h2>
          </div>
          {timeLoad ? (
            <p className="text-sm text-slate-400 text-center py-8">Loading…</p>
          ) : timeData?.totalOpens === 0 ? (
            <p className="text-sm text-slate-400 text-center py-6">No open tracking data yet. Send some emails first!</p>
          ) : (
            <>
              {bestSlot && (
                <div className="mb-4 px-3 py-2.5 rounded-xl text-sm font-semibold"
                     style={{ background: 'linear-gradient(135deg, #eff6ff, #f0fdf4)', border: '1px solid #bfdbfe' }}>
                  <span className="text-indigo-700">🏆 Best slot: </span>
                  <span className="text-slate-800">
                    {DAYS_FULL[bestSlot.dow]} at {HOURS[bestSlot.hour]}
                  </span>
                  <span className="text-[11px] text-slate-500 ml-2">({bestSlot.opens} opens)</span>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                {/* By hour (top 12 for space) */}
                <div>
                  <div className="flex items-center gap-1 mb-2">
                    <Clock size={12} className="text-slate-400" />
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">By Hour</span>
                  </div>
                  <div className="space-y-1">
                    {[...byHour].sort((a,b)=>b.opens-a.opens).slice(0,8).map(h => (
                      <MiniBar
                        key={h.hour}
                        label={HOURS[h.hour]}
                        value={h.opens}
                        max={maxHour}
                        count={h.opens}
                        color="#6366f1"
                      />
                    ))}
                  </div>
                </div>
                {/* By day */}
                <div>
                  <div className="flex items-center gap-1 mb-2">
                    <Calendar size={12} className="text-slate-400" />
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">By Day</span>
                  </div>
                  <div className="space-y-1">
                    {[...byDow].sort((a,b)=>b.opens-a.opens).map(d => (
                      <MiniBar
                        key={d.dow}
                        label={d.day}
                        value={d.opens}
                        max={maxDow}
                        count={d.opens}
                        color="#10b981"
                      />
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Campaign table */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden"
           style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
        <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
          <BarChart2 size={16} className="text-indigo-500" />
          <h2 className="text-sm font-bold text-slate-800">Per-Campaign Breakdown</h2>
          <span className="ml-auto text-[11px] text-slate-400">{campaigns.length} campaigns</span>
        </div>

        {loading ? (
          <div className="text-center py-16 text-slate-400 text-sm">Loading analytics…</div>
        ) : campaigns.length === 0 ? (
          <div className="text-center py-16 text-slate-400">
            <BarChart2 size={32} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm">No campaign data yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <Th col="name">Campaign</Th>
                  <Th col="sent"        right>Sent</Th>
                  <Th col="openRate"    right>Open %</Th>
                  <Th col="clickRate"   right>Click %</Th>
                  <Th col="replyRate"   right>Reply %</Th>
                  <Th col="bounceRate"  right>Bounce %</Th>
                  <Th col="unsubRate"   right>Unsub %</Th>
                  <Th col="lastSentAt"  right>Last Sent</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {sorted.map(c => (
                  <>
                    <tr
                      key={c.id}
                      className="hover:bg-slate-50 cursor-pointer transition-colors"
                      onClick={() => setExpanded(expanded === c.id ? null : c.id)}
                    >
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                            c.status === 'COMPLETED' ? 'bg-emerald-400' :
                            c.status === 'RUNNING'   ? 'bg-blue-400 animate-pulse' :
                            c.status === 'FAILED'    ? 'bg-red-400' : 'bg-slate-300'
                          }`} />
                          <span className="font-medium text-slate-800 truncate max-w-[180px]" title={c.name}>
                            {c.name}
                          </span>
                          {expanded === c.id
                            ? <ChevronUp size={12} className="text-slate-400 flex-shrink-0" />
                            : <ChevronDown size={12} className="text-slate-400 flex-shrink-0" />}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right font-semibold text-slate-700">{fmt(c.sent)}</td>
                      <td className="px-3 py-3 text-right"><RatePill rate={c.openRate} /></td>
                      <td className="px-3 py-3 text-right"><RatePill rate={c.clickRate} /></td>
                      <td className="px-3 py-3 text-right"><RatePill rate={c.replyRate} /></td>
                      <td className="px-3 py-3 text-right"><RatePill rate={c.bounceRate} isBounce /></td>
                      <td className="px-3 py-3 text-right">
                        <span className="text-[11px] font-bold text-slate-500">{c.unsubRate}%</span>
                      </td>
                      <td className="px-3 py-3 text-right text-[11px] text-slate-400">
                        {c.lastSentAt ? new Date(Number(c.lastSentAt)).toLocaleDateString() : '—'}
                      </td>
                    </tr>

                    {/* Expanded row */}
                    {expanded === c.id && (
                      <tr key={c.id + '_exp'}>
                        <td colSpan={8} className="px-6 pb-4 pt-1 bg-slate-50">
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-2">
                            <div className="bg-white rounded-xl p-3 border border-slate-200">
                              <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wider">Unique Opens</p>
                              <p className="text-lg font-bold text-emerald-600">{fmt(c.uniqueOpens)}</p>
                              <p className="text-[10px] text-slate-400">{fmt(c.totalOpens)} total opens</p>
                            </div>
                            <div className="bg-white rounded-xl p-3 border border-slate-200">
                              <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wider">Unique Clicks</p>
                              <p className="text-lg font-bold text-amber-600">{fmt(c.uniqueClicks)}</p>
                              <p className="text-[10px] text-slate-400">{fmt(c.totalClicks)} total clicks</p>
                            </div>
                            <div className="bg-white rounded-xl p-3 border border-slate-200">
                              <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wider">Replies</p>
                              <p className="text-lg font-bold text-blue-600">{fmt(c.replies)}</p>
                              <p className="text-[10px] text-slate-400">{c.replyRate}% rate</p>
                            </div>
                            <div className="bg-white rounded-xl p-3 border border-slate-200">
                              <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wider">Issues</p>
                              <p className="text-lg font-bold text-red-500">{fmt(c.bounces + c.unsubscribes + c.failed)}</p>
                              <p className="text-[10px] text-slate-400">
                                {fmt(c.bounces)} bounced · {fmt(c.unsubscribes)} unsub · {fmt(c.failed)} failed
                              </p>
                            </div>
                          </div>
                          {c.subjectPreview && (
                            <p className="mt-3 text-[11px] text-slate-500">
                              <span className="font-semibold">Subject: </span>{c.subjectPreview}
                            </p>
                          )}
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
