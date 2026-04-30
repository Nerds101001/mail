import { useState, useEffect, useCallback, useRef } from 'react'
import { StatCard, Empty, PageHeader, Btn, toast } from '../components/ui'
import { Send, Eye, MousePointer, MessageSquare, RefreshCw, Clock, Search, Filter, ChevronDown } from 'lucide-react'

const AUTO_REFRESH_SECS = 60

// ── Helpers ───────────────────────────────────────────────────────────────────
function parseBrowser(ua) {
  if (!ua || ua === '—') return '—'
  let os = 'Unknown'
  if (/Windows NT 1[01]/.test(ua))        os = 'Windows 10/11'
  else if (/Windows NT 6\.[13]/.test(ua)) os = 'Windows 7/8'
  else if (/Macintosh|Mac OS X/.test(ua)) os = 'macOS'
  else if (/iPhone/.test(ua))             os = 'iOS'
  else if (/iPad/.test(ua))               os = 'iPadOS'
  else if (/Android/.test(ua))            os = 'Android'
  else if (/Linux/.test(ua))              os = 'Linux'
  let br = 'Browser'
  if (/Edg\//.test(ua))            br = 'Edge'
  else if (/OPR\/|Opera/.test(ua)) br = 'Opera'
  else if (/Firefox\//.test(ua))   br = 'Firefox'
  else if (/Chrome\//.test(ua))    br = 'Chrome'
  else if (/Safari\//.test(ua))    br = 'Safari'
  return `${br} / ${os}`
}

function fmtTs(ts) {
  if (!ts) return '—'
  try { return new Date(parseInt(ts)).toLocaleString('en-IN') } catch { return '—' }
}

const STATUS_COLORS = {
  sent:        'bg-blue-100 text-blue-700',
  SENT:        'bg-blue-100 text-blue-700',
  failed:      'bg-red-100 text-red-600',
  FAILED:      'bg-red-100 text-red-600',
  skipped:     'bg-slate-100 text-slate-500',
  SKIPPED:     'bg-slate-100 text-slate-500',
  replied:     'bg-purple-100 text-purple-700',
  REPLIED:     'bg-purple-100 text-purple-700',
  bounced:     'bg-red-100 text-red-600',
  BOUNCED:     'bg-red-100 text-red-600',
}

export default function Tracking() {
  const [sends, setSends]           = useState([])
  const [campaigns, setCampaigns]   = useState([])
  const [loading, setLoading]       = useState(true)
  const [syncing, setSyncing]       = useState(false)
  const [lastSync, setLastSync]     = useState('')
  const [countdown, setCountdown]   = useState(AUTO_REFRESH_SECS)

  // Filters
  const [campFilter, setCampFilter]   = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [dateFrom, setDateFrom]       = useState('')
  const [dateTo, setDateTo]           = useState('')
  const [search, setSearch]           = useState('')

  // Events
  const [selectedSend, setSelectedSend] = useState(null)
  const [eventLog, setEventLog]         = useState([])
  const [eventsLoading, setEventsLoading] = useState(false)

  const sendsRef = useRef(sends)
  useEffect(() => { sendsRef.current = sends }, [sends])

  const loadData = useCallback(async (silent = false) => {
    if (!silent) setSyncing(true)
    try {
      const url = campFilter
        ? `/api/ops?type=all-sends&campaign=${encodeURIComponent(campFilter)}`
        : `/api/ops?type=all-sends`
      const res = await fetch(url)
      if (!res.ok) throw new Error('API error')
      const data = await res.json()
      setSends(data.sends || [])
      setCampaigns(data.campaigns || [])
      setLastSync(new Date().toLocaleTimeString())
    } catch(e) {
      if (!silent) toast('Could not load tracking data', 'error')
    }
    if (!silent) setSyncing(false)
    setLoading(false)
  }, [campFilter])

  // Initial load + reload when campaign filter changes
  useEffect(() => { setLoading(true); loadData() }, [loadData])

  // Auto-refresh countdown
  useEffect(() => {
    setCountdown(AUTO_REFRESH_SECS)
    const tick = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) { loadData(true); return AUTO_REFRESH_SECS }
        return c - 1
      })
    }, 1000)
    return () => clearInterval(tick)
  }, [loadData])

  async function viewEvents(send) {
    setSelectedSend(send)
    setEventLog([])
    setEventsLoading(true)
    try {
      const res = await fetch(`/api/ops?type=events&leadId=${send.lead_id}`)
      if (!res.ok) throw new Error()
      const data = await res.json()
      setEventLog(data.events || [])
    } catch(e) { setEventLog([]) }
    setEventsLoading(false)
  }

  // ── Filtering ─────────────────────────────────────────────────────────────
  const filtered = sends.filter(s => {
    if (statusFilter && s.status?.toLowerCase() !== statusFilter.toLowerCase()) return false
    if (dateFrom) {
      const d = new Date(dateFrom).getTime()
      if (parseInt(s.sent_at) < d) return false
    }
    if (dateTo) {
      const d = new Date(dateTo).getTime() + 86400000
      if (parseInt(s.sent_at) > d) return false
    }
    if (search) {
      const q = search.toLowerCase()
      if (!`${s.lead_name||''} ${s.lead_email||''} ${s.lead_company||''}`.toLowerCase().includes(q)) return false
    }
    return true
  })

  // ── Aggregate stats ───────────────────────────────────────────────────────
  const totalSent    = filtered.filter(s => !['failed','FAILED','skipped','SKIPPED'].includes(s.status)).length
  const totalOpens   = filtered.reduce((n, s) => n + (s.opens  || 0), 0)
  const totalClicks  = filtered.reduce((n, s) => n + (s.clicks || 0), 0)
  const totalReplied = filtered.filter(s => ['replied','REPLIED'].includes(s.status)).length
  const totalBounced = filtered.filter(s => ['bounced','BOUNCED'].includes(s.status)).length
  const uniqueOpeners = new Set(filtered.filter(s => (s.opens||0) > 0).map(s => s.lead_id)).size

  if (loading) return (
    <div>
      <PageHeader title="Mail Tracking" subtitle="All sends across all campaigns" />
      <div className="card p-16 text-center text-sm text-slate-400">Loading tracking data…</div>
    </div>
  )

  return (
    <div>
      <PageHeader title="Mail Tracking" subtitle={`${sends.length} total sends across ${campaigns.length} campaigns`}>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-400 flex items-center gap-1">
            <Clock size={11}/> auto-refresh in {countdown}s
          </span>
          <Btn variant="secondary" size="sm" onClick={() => loadData()} disabled={syncing}>
            <RefreshCw size={13} className={syncing ? 'animate-spin' : ''}/> Sync Now
          </Btn>
        </div>
      </PageHeader>

      {lastSync && <div className="mb-3 text-xs text-slate-400">Last synced: {lastSync}</div>}

      {/* Summary Stats */}
      <div className="grid grid-cols-6 gap-3 mb-5">
        <StatCard label="Campaigns"    value={campaigns.length}   icon={Filter}        color="slate" />
        <StatCard label="Emails Sent"  value={totalSent}          icon={Send}          color="blue" />
        <StatCard label="Unique Opens" value={uniqueOpeners}      sub={totalSent ? Math.round(uniqueOpeners/totalSent*100)+'% rate' : ''} icon={Eye} color="emerald" />
        <StatCard label="Total Opens"  value={totalOpens}         icon={Eye}           color="blue" />
        <StatCard label="Clicks"       value={totalClicks}        sub={totalSent ? Math.round(totalClicks/totalSent*100)+'% CTR' : ''} icon={MousePointer} color="amber" />
        <StatCard label="Replies"      value={totalReplied}       sub={totalSent ? Math.round(totalReplied/totalSent*100)+'%' : ''} icon={MessageSquare} color="purple" />
      </div>

      {/* Filters */}
      <div className="card p-4 mb-4">
        <div className="flex gap-3 flex-wrap items-end">
          {/* Campaign filter */}
          <div className="flex-1 min-w-[180px]">
            <label className="label">Campaign</label>
            <div className="relative">
              <ChevronDown size={12} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"/>
              <select className="input pr-7 appearance-none" value={campFilter} onChange={e => setCampFilter(e.target.value)}>
                <option value="">All Campaigns</option>
                {campaigns.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          </div>
          {/* Status filter */}
          <div className="min-w-[130px]">
            <label className="label">Status</label>
            <select className="input" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
              <option value="">All Statuses</option>
              <option value="sent">Sent</option>
              <option value="replied">Replied</option>
              <option value="bounced">Bounced</option>
              <option value="failed">Failed</option>
              <option value="skipped">Skipped</option>
            </select>
          </div>
          {/* Date range */}
          <div className="min-w-[130px]">
            <label className="label">From Date</label>
            <input type="date" className="input" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
          </div>
          <div className="min-w-[130px]">
            <label className="label">To Date</label>
            <input type="date" className="input" value={dateTo} onChange={e => setDateTo(e.target.value)} />
          </div>
          {/* Search */}
          <div className="flex-1 min-w-[180px]">
            <label className="label">Search</label>
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/>
              <input className="input pl-8" placeholder="Name, email, company…" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
          </div>
          {/* Clear */}
          {(campFilter || statusFilter || dateFrom || dateTo || search) && (
            <Btn variant="ghost" size="sm" onClick={() => { setCampFilter(''); setStatusFilter(''); setDateFrom(''); setDateTo(''); setSearch('') }}>✕ Clear</Btn>
          )}
        </div>
      </div>

      {/* Sends Table */}
      <div className="card overflow-hidden mb-6">
        <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 text-xs text-slate-500">
          Showing <span className="font-semibold text-slate-700">{filtered.length}</span> sends
          {filtered.length !== sends.length && ` (filtered from ${sends.length})`}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                {['Lead Name','Email','Company','Campaign','Status','Opens','Clicks','Variant','Sent At','Actions'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={10}><Empty icon={Send} title="No sends match your filters" sub="Try adjusting the campaign or date range" /></td></tr>
              ) : filtered.map((s, i) => (
                <tr key={s.id || i} className={`table-row ${selectedSend?.id === s.id ? 'bg-emerald-50/50' : ''}`}>
                  <td className="px-4 py-3 font-semibold text-slate-900 whitespace-nowrap">{s.lead_name || '—'}</td>
                  <td className="px-4 py-3 text-slate-500 font-mono text-xs">{s.lead_email}</td>
                  <td className="px-4 py-3 text-slate-600 text-xs">{s.lead_company || '—'}</td>
                  <td className="px-4 py-3 text-xs">
                    <span className="text-slate-700 font-medium">{s.campaign_name || '—'}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`badge text-[11px] ${STATUS_COLORS[s.status] || 'bg-slate-100 text-slate-600'}`}>
                      {s.status === 'BOUNCED' || s.status === 'bounced' ? '⚡ Bounced' : (s.status || '—')}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-blue-600 w-6 text-right">{s.opens || 0}</span>
                      <div className="flex-1 h-1.5 bg-slate-100 rounded-full min-w-[50px]">
                        <div className="h-full bg-blue-400 rounded-full" style={{ width: `${Math.min((s.opens||0)*15, 100)}%` }} />
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-amber-600 w-6 text-right">{s.clicks || 0}</span>
                      <div className="flex-1 h-1.5 bg-slate-100 rounded-full min-w-[50px]">
                        <div className="h-full bg-amber-400 rounded-full" style={{ width: `${Math.min((s.clicks||0)*20, 100)}%` }} />
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="w-5 h-5 inline-flex items-center justify-center bg-slate-100 text-slate-600 rounded-full text-[10px] font-bold">
                      {(s.variant_index ?? 0) + 1}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-400 text-xs whitespace-nowrap">{fmtTs(s.sent_at)}</td>
                  <td className="px-4 py-3">
                    <Btn variant="ghost" size="sm" onClick={() => selectedSend?.id === s.id ? setSelectedSend(null) : viewEvents(s)}>
                      📋 Events
                    </Btn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Event Log Panel */}
      {selectedSend && (
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 bg-slate-50">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                📋 Tracking Events — {selectedSend.lead_name} &lt;{selectedSend.lead_email}&gt;
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">Campaign: {selectedSend.campaign_name} · Sent: {fmtTs(selectedSend.sent_at)}</p>
            </div>
            <button className="text-slate-400 hover:text-slate-600 text-xl leading-none" onClick={() => setSelectedSend(null)}>✕</button>
          </div>

          {eventsLoading ? (
            <div className="p-8 text-center text-sm text-slate-400">Loading events…</div>
          ) : eventLog.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-sm font-medium text-slate-500">No tracking events recorded yet</p>
              <p className="text-xs text-slate-400 mt-1">Opens appear when the recipient loads the email. Clicks appear when they click a link.</p>
            </div>
          ) : (
            <>
              {/* Event summary row */}
              <div className="px-5 py-3 bg-slate-50 border-b border-slate-100 flex gap-6 text-xs">
                <span className="font-semibold text-slate-700">{eventLog.length} total events</span>
                <span className="text-blue-600">{eventLog.filter(e=>e.event_type==='open').length} opens</span>
                <span className="text-amber-600">{eventLog.filter(e=>e.event_type==='click').length} clicks</span>
                <span className="text-slate-400">
                  First: {fmtTs(Math.min(...eventLog.map(e=>parseInt(e.created_at))).toString())}
                </span>
                <span className="text-slate-400">
                  Last: {fmtTs(Math.max(...eventLog.map(e=>parseInt(e.created_at))).toString())}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      {['Event','Timestamp','IP Address','Device / Browser','Clicked URL'].map(h => (
                        <th key={h} className="px-4 py-2 text-left font-bold text-slate-500 uppercase tracking-wide">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {eventLog.map((e, i) => {
                      const clickUrl = e.event_type === 'click' && e.target_url && !e.target_url.startsWith('campaign:') ? e.target_url : null
                      return (
                        <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                          <td className="px-4 py-2.5">
                            <span className={`badge text-[11px] ${e.event_type==='open' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}`}>
                              {e.event_type==='open' ? '👁 Opened' : '🖱 Clicked'}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-slate-600 font-mono whitespace-nowrap">{fmtTs(e.created_at)}</td>
                          <td className="px-4 py-2.5 text-slate-500 font-mono">{e.ip || '—'}</td>
                          <td className="px-4 py-2.5 text-slate-600">{parseBrowser(e.user_agent)}</td>
                          <td className="px-4 py-2.5 text-slate-500 max-w-[240px]">
                            {clickUrl
                              ? <a href={clickUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline truncate block" title={clickUrl}>
                                  {clickUrl.replace(/^https?:\/\//,'').substring(0,50)}{clickUrl.length>50?'…':''}
                                </a>
                              : <span className="text-slate-300">—</span>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
