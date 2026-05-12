import { useState, useEffect, useCallback, useMemo } from 'react'
import { useCRM } from '../store'
import { PIPELINE_STAGES, STAGE_COLORS } from '../utils'
import { PageHeader, Btn } from '../components/ui'
import { Flame, Eye, MousePointer, Search, RefreshCw, Filter, X } from 'lucide-react'

const TABS = ['ALL', 'COLD', 'CONTACTED', 'OPENED', 'HOT', 'DEMO', 'QUOTED', 'WON', 'LOST', 'UNSUBSCRIBED']

const TAB_META = {
  ALL:          { icon: '📋', label: 'All Leads' },
  COLD:         { icon: '🧊', label: 'Cold' },
  CONTACTED:    { icon: '📧', label: 'Contacted' },
  OPENED:       { icon: '👁', label: 'Opened' },
  HOT:          { icon: '🔥', label: 'Hot' },
  DEMO:         { icon: '🎯', label: 'Demo' },
  QUOTED:       { icon: '💰', label: 'Quoted' },
  WON:          { icon: '✅', label: 'Won' },
  LOST:         { icon: '❌', label: 'Lost' },
  UNSUBSCRIBED: { icon: '🚫', label: 'Unsub' },
}

export default function Pipeline() {
  const { leads, setLeads, saveLeads } = useCRM()

  const [activeTab,      setActiveTab]      = useState('ALL')
  const [search,         setSearch]         = useState('')
  const [groupF,         setGroupF]         = useState('')   // lead group filter
  const [campF,          setCampF]          = useState('')   // campaign filter
  const [campaigns,      setCampaigns]      = useState([])   // campaign list for dropdown
  const [campLeadIds,    setCampLeadIds]    = useState(null) // Set<leadId> for selected campaign, null = all
  const [campLoading,    setCampLoading]    = useState(false)
  const [trackMap,       setTrackMap]       = useState({})   // leadId → {opens,clicks,subject,sentAt,body}
  const [loadingTrack,   setLoadingTrack]   = useState(false)
  const [expandedBody,   setExpandedBody]   = useState(null)

  const token = () => localStorage.getItem('crm_token') || ''

  // ── Fetch tracking (opens/clicks/last email) ──────────────────────────
  const fetchTracking = useCallback(async () => {
    setLoadingTrack(true)
    try {
      const res = await fetch('/api/crm?type=lead-tracking', {
        headers: { Authorization: `Bearer ${token()}` }
      })
      if (res.ok) setTrackMap(await res.json())
    } catch(e) { console.warn('tracking fetch failed', e) }
    setLoadingTrack(false)
  }, [])

  // ── Fetch campaigns list for dropdown ────────────────────────────────
  const fetchCampaigns = useCallback(async () => {
    try {
      const res = await fetch('/api/crm?type=campaigns', {
        headers: { Authorization: `Bearer ${token()}` }
      })
      if (res.ok) {
        const data = await res.json()
        if (Array.isArray(data)) setCampaigns(data)
      }
    } catch(e) { console.warn('campaigns fetch failed', e) }
  }, [])

  useEffect(() => {
    fetchTracking()
    fetchCampaigns()
  }, [fetchTracking, fetchCampaigns])

  // ── When campaign filter changes, fetch that campaign's lead IDs ──────
  useEffect(() => {
    if (!campF) { setCampLeadIds(null); return }
    setCampLoading(true)
    fetch(`/api/crm?type=campaigns&id=${campF}`, {
      headers: { Authorization: `Bearer ${token()}` }
    })
      .then(r => r.json())
      .then(data => {
        const ids = new Set((data.leads || []).map(l => l.lead_id))
        setCampLeadIds(ids)
      })
      .catch(() => setCampLeadIds(null))
      .finally(() => setCampLoading(false))
  }, [campF])

  // ── Unique groups from leads ──────────────────────────────────────────
  const uniqueGroups = useMemo(() => {
    const s = new Set(leads.map(l => l.group || 'Default').filter(Boolean))
    return [...s].sort()
  }, [leads])

  // ── Base filtered set (group + campaign filters only, no stage/search) ─
  const baseFiltered = useMemo(() => leads.filter(l => {
    if (groupF && (l.group || 'Default') !== groupF) return false
    if (campLeadIds && !campLeadIds.has(l.id)) return false
    return true
  }), [leads, groupF, campLeadIds])

  // ── Stage counts (reflect group + campaign filter) ───────────────────
  const counts = useMemo(() => {
    const c = {}
    baseFiltered.forEach(l => {
      const s = l.pipelineStage || 'COLD'
      c[s] = (c[s] || 0) + 1
    })
    c.ALL = baseFiltered.length
    return c
  }, [baseFiltered])

  // ── Final filtered rows (stage tab + search on top of base) ──────────
  const filtered = useMemo(() => baseFiltered.filter(l => {
    const stage = l.pipelineStage || 'COLD'
    if (activeTab !== 'ALL' && stage !== activeTab) return false
    if (search) {
      const q = search.toLowerCase()
      return (l.name||'').toLowerCase().includes(q)
        || (l.email||'').toLowerCase().includes(q)
        || (l.company||'').toLowerCase().includes(q)
    }
    return true
  }), [baseFiltered, activeTab, search])

  function changeStage(id, stage) {
    const newLeads = leads.map(l => l.id === id ? { ...l, pipelineStage: stage } : l)
    setLeads(newLeads)
    saveLeads(newLeads)
  }

  function clearFilters() {
    setGroupF('')
    setCampF('')
    setCampLeadIds(null)
    setSearch('')
    setActiveTab('ALL')
  }

  const hasFilters = groupF || campF || search || activeTab !== 'ALL'

  const fmtDate = (ts) => {
    if (!ts) return '—'
    const d = new Date(Number(ts))
    if (isNaN(d)) return '—'
    return d.toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' })
  }

  const selectedCamp = campaigns.find(c => c.id === campF)

  return (
    <div className="space-y-4">
      <PageHeader
        title="Lead Pipeline"
        subtitle={`${leads.length} total leads across all stages`}
        action={
          <Btn variant="secondary" onClick={fetchTracking} disabled={loadingTrack}>
            <RefreshCw size={13} className={loadingTrack ? 'animate-spin' : ''} />
            {loadingTrack ? 'Syncing...' : 'Sync Tracking'}
          </Btn>
        }
      />

      {/* ── Global Filters ─────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">
            <Filter size={12} /> Filters
          </div>

          {/* Lead Group */}
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-slate-500 whitespace-nowrap">Lead Group</label>
            <select
              className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-700 hover:border-slate-300 focus:outline-none focus:ring-1 focus:ring-blue-400 min-w-[130px]"
              value={groupF}
              onChange={e => setGroupF(e.target.value)}
            >
              <option value="">All Groups</option>
              {uniqueGroups.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>

          {/* Campaign */}
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-slate-500 whitespace-nowrap">Campaign</label>
            <select
              className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-700 hover:border-slate-300 focus:outline-none focus:ring-1 focus:ring-blue-400 min-w-[180px]"
              value={campF}
              onChange={e => setCampF(e.target.value)}
              disabled={campLoading}
            >
              <option value="">All Campaigns</option>
              {campaigns.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.total_sent || 0} sent)
                </option>
              ))}
            </select>
            {campLoading && <span className="text-xs text-slate-400 animate-pulse">loading…</span>}
          </div>

          {/* Active filter chips */}
          {groupF && (
            <span className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-medium">
              👥 {groupF}
              <button onClick={() => setGroupF('')} className="hover:text-blue-900 ml-0.5"><X size={10}/></button>
            </span>
          )}
          {campF && selectedCamp && (
            <span className="inline-flex items-center gap-1 px-2 py-1 bg-purple-100 text-purple-700 rounded-full text-xs font-medium">
              📣 {selectedCamp.name}
              <button onClick={() => { setCampF(''); setCampLeadIds(null) }} className="hover:text-purple-900 ml-0.5"><X size={10}/></button>
            </span>
          )}

          {/* Clear all */}
          {hasFilters && (
            <button
              onClick={clearFilters}
              className="ml-auto text-xs text-slate-400 hover:text-slate-600 underline underline-offset-2 transition-colors"
            >
              Clear all
            </button>
          )}
        </div>

        {/* Summary line when filtered */}
        {(groupF || campF) && (
          <div className="mt-2 pt-2 border-t border-slate-100 text-xs text-slate-500">
            Showing <strong className="text-slate-700">{baseFiltered.length}</strong> leads
            {groupF && <> in group <strong className="text-blue-600">"{groupF}"</strong></>}
            {campF && selectedCamp && <> from campaign <strong className="text-purple-600">"{selectedCamp.name}"</strong></>}
          </div>
        )}
      </div>

      {/* ── Stage Tabs ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2">
        {TABS.map(tab => {
          const sc     = tab === 'ALL' ? null : (STAGE_COLORS[tab] || STAGE_COLORS.COLD)
          const meta   = TAB_META[tab] || { icon: '•', label: tab }
          const cnt    = counts[tab] || 0
          const active = activeTab === tab
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold border transition-all duration-150 whitespace-nowrap
                ${active
                  ? tab === 'ALL'
                    ? 'bg-slate-800 text-white border-slate-800 shadow-md'
                    : `${sc.bg} ${sc.text} border-current shadow-md`
                  : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300 hover:text-slate-700'
                }`}
            >
              <span>{meta.icon}</span>
              <span>{meta.label}</span>
              <span className={`text-xs px-1.5 py-0.5 rounded-full font-bold ml-0.5
                ${active ? 'bg-black/10' : 'bg-slate-100 text-slate-500'}`}>
                {cnt}
              </span>
            </button>
          )
        })}
      </div>

      {/* ── Search bar ─────────────────────────────────────────────────── */}
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          className="w-full pl-9 pr-4 py-2 text-sm border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
          placeholder="Search name, email, company..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* ── Table ──────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
          <span className="text-sm font-semibold text-slate-700">
            {activeTab === 'ALL' ? 'All Leads' : TAB_META[activeTab]?.label}
            <span className="ml-2 text-xs text-slate-400 font-normal">{filtered.length} leads</span>
          </span>
          {campLeadIds && (
            <span className="text-xs text-purple-600 bg-purple-50 px-2 py-0.5 rounded-full">
              📣 Campaign view — {campLeadIds.size} leads in campaign
            </span>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-left">
                <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Name</th>
                <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Email</th>
                <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Company</th>
                <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Group</th>
                <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Stage</th>
                <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Last Subject</th>
                <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Sent</th>
                <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide text-center">Opens</th>
                <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide text-center">Clicks</th>
                <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Change Stage</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-12 text-center text-sm text-slate-400">
                    No leads match the current filters
                  </td>
                </tr>
              )}
              {filtered.map(l => {
                const stage    = l.pipelineStage || 'COLD'
                const sc       = STAGE_COLORS[stage] || STAGE_COLORS.COLD
                const track    = trackMap[l.id] || {}
                const opens    = track.opens  || 0
                const clicks   = track.clicks || 0
                const isHot    = opens >= 2 || clicks >= 1
                const bodyOpen = expandedBody === l.id

                return (
                  <>
                    <tr key={l.id} className="hover:bg-slate-50 transition-colors">
                      {/* Name */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium text-slate-800">{l.name || '—'}</span>
                          {isHot && <Flame size={12} className="text-red-500 flex-shrink-0" />}
                        </div>
                      </td>

                      {/* Email */}
                      <td className="px-4 py-3">
                        <span className="text-slate-500 font-mono text-xs">{l.email}</span>
                      </td>

                      {/* Company */}
                      <td className="px-4 py-3">
                        <span className="text-slate-600 text-xs">{l.company || '—'}</span>
                      </td>

                      {/* Group */}
                      <td className="px-4 py-3">
                        <span
                          className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 cursor-pointer hover:bg-blue-100"
                          onClick={() => setGroupF(l.group || 'Default')}
                          title="Click to filter by this group"
                        >
                          {l.group || 'Default'}
                        </span>
                      </td>

                      {/* Stage badge */}
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${sc.bg} ${sc.text}`}>
                          {TAB_META[stage]?.icon} {stage}
                        </span>
                      </td>

                      {/* Last subject */}
                      <td className="px-4 py-3 max-w-[180px]">
                        {track.subject ? (
                          <div>
                            <p className="text-xs text-slate-700 truncate" title={track.subject}>{track.subject}</p>
                            {track.body && (
                              <button
                                onClick={() => setExpandedBody(bodyOpen ? null : l.id)}
                                className="text-[10px] text-blue-500 hover:underline mt-0.5"
                              >
                                {bodyOpen ? 'hide' : 'view body'}
                              </button>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-slate-300">No email sent</span>
                        )}
                      </td>

                      {/* Sent date */}
                      <td className="px-4 py-3">
                        <span className="text-xs text-slate-500">{fmtDate(track.sentAt || l.lastSent)}</span>
                      </td>

                      {/* Opens */}
                      <td className="px-4 py-3 text-center">
                        {opens > 0 ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-50 text-amber-700 rounded-full text-xs font-semibold">
                            <Eye size={10} /> {opens}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-300">0</span>
                        )}
                      </td>

                      {/* Clicks */}
                      <td className="px-4 py-3 text-center">
                        {clicks > 0 ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-50 text-blue-700 rounded-full text-xs font-semibold">
                            <MousePointer size={10} /> {clicks}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-300">0</span>
                        )}
                      </td>

                      {/* Stage change */}
                      <td className="px-4 py-3">
                        <select
                          className="text-xs border border-slate-200 rounded-lg px-2 py-1 bg-white text-slate-600 hover:border-slate-300 focus:outline-none focus:ring-1 focus:ring-blue-400 transition-colors"
                          value={stage}
                          onChange={e => changeStage(l.id, e.target.value)}
                        >
                          {PIPELINE_STAGES.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </td>
                    </tr>

                    {/* Expanded email body row */}
                    {bodyOpen && track.body && (
                      <tr key={`${l.id}-body`} className="bg-slate-50">
                        <td colSpan={10} className="px-8 py-3">
                          <div className="text-xs text-slate-600 whitespace-pre-wrap bg-white border border-slate-200 rounded-lg p-3 max-h-40 overflow-y-auto leading-relaxed">
                            {track.body}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
