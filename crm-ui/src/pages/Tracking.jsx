import { useState, useEffect, useRef, useCallback } from 'react'
import { useCRM } from '../store'
import { fmtDate } from '../utils'
import { StatCard, Empty, PageHeader, Btn, toast } from '../components/ui'
import { Send, Eye, MousePointer, MessageSquare, RefreshCw, Clock } from 'lucide-react'

const AUTO_REFRESH_SECS = 60

function parseBrowser(ua) {
  if (!ua || ua === '—') return '—'
  if (/iPhone|iPad/.test(ua)) return 'Safari / iOS'
  if (/Android/.test(ua) && /Chrome/.test(ua)) return 'Chrome / Android'
  if (/Android/.test(ua)) return 'Browser / Android'
  if (/Edg\//.test(ua)) return 'Edge / Desktop'
  if (/OPR\/|Opera/.test(ua)) return 'Opera / Desktop'
  if (/Firefox\//.test(ua)) return 'Firefox / Desktop'
  if (/Chrome\//.test(ua)) return 'Chrome / Desktop'
  if (/Safari\//.test(ua)) return 'Safari / Desktop'
  return ua.substring(0, 50)
}

export default function Tracking() {
  const { leads, setLeads, pushToRedis, logActivity } = useCRM()
  const [syncing, setSyncing]       = useState(false)
  const [info, setInfo]             = useState('')
  const [eventLog, setEventLog]     = useState([])
  const [selectedLead, setSelectedLead] = useState(null)
  const [countdown, setCountdown]   = useState(AUTO_REFRESH_SECS)

  const sent       = leads.filter(l => ['SENT','REPLIED','FOLLOW-UP','BOUNCED'].includes(l.status))
  const totalOpens  = leads.reduce((s, l) => s + (l.opens || 0), 0)
  const totalClicks = leads.reduce((s, l) => s + (l.clicks || 0), 0)
  const replied    = leads.filter(l => l.status === 'REPLIED').length
  const bounced    = leads.filter(l => l.status === 'BOUNCED').length

  // Keep ref to latest sync fn to avoid stale closure inside setInterval
  const leadsRef = useRef(leads)
  useEffect(() => { leadsRef.current = leads }, [leads])

  const syncTracking = useCallback(async (silent = false) => {
    const currentLeads = leadsRef.current
    const currentSent = currentLeads.filter(l => ['SENT','REPLIED','FOLLOW-UP','BOUNCED'].includes(l.status))
    if (!currentSent.length) return
    if (!silent) setSyncing(true)
    try {
      const ids = currentSent.map(l => l.id).join(',')
      const res = await fetch(`/api/ops?type=tracking&ids=${ids}`)
      if (!res.ok) throw new Error('API unavailable')
      const stats = await res.json()

      let updated = 0
      const newLeads = currentLeads.map(l => {
        if (!stats[l.id]) return l
        const so = stats[l.id].opens || 0, sc = stats[l.id].clicks || 0
        if (so !== l.opens || sc !== l.clicks) { updated++; return { ...l, opens: so, clicks: sc } }
        return l
      })
      if (updated > 0) { setLeads(newLeads); pushToRedis() }
      setInfo(`✓ Synced ${currentSent.length} leads — ${new Date().toLocaleTimeString()}`)
    } catch(e) { setInfo('⚠ Could not sync from server') }
    if (!silent) setSyncing(false)
  }, [setLeads, pushToRedis])

  // Initial sync
  useEffect(() => { syncTracking() }, [])

  // Auto-refresh every 60s + countdown
  useEffect(() => {
    setCountdown(AUTO_REFRESH_SECS)
    const tick = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) {
          syncTracking(true)
          return AUTO_REFRESH_SECS
        }
        return c - 1
      })
    }, 1000)
    return () => clearInterval(tick)
  }, [syncTracking])

  async function viewEvents(leadId) {
    setSelectedLead(leadId)
    setEventLog([])
    try {
      const res = await fetch(`/api/ops?type=events&leadId=${leadId}`)
      if (!res.ok) throw new Error('API unavailable')
      const data = await res.json()
      setEventLog(data.events || [])
    } catch(e) { setEventLog([]) }
  }

  async function markReplied(id) {
    const lead = leads.find(l => l.id === id)
    setLeads(leads.map(l => l.id === id ? { ...l, status: 'REPLIED', pipelineStage: 'WON' } : l))
    pushToRedis()
    logActivity(`Marked replied: ${lead?.name}`)
    toast(`${lead?.name} marked as replied`, 'success')
    // Update campaign_leads status in DB for AI feedback loop
    try {
      await fetch('/api/crm?type=mark-replied', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('crm_token')}` },
        body: JSON.stringify({ leadId: id })
      })
    } catch(e) { /* non-critical */ }
  }

  return (
    <div>
      <PageHeader title="Mail Tracking" subtitle="Real-time open and click tracking">
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-400 flex items-center gap-1">
            <Clock size={11} /> auto-refresh in {countdown}s
          </span>
          <Btn variant="secondary" size="sm" onClick={() => syncTracking()} disabled={syncing}>
            <RefreshCw size={13} className={syncing ? 'animate-spin' : ''} /> Sync Now
          </Btn>
        </div>
      </PageHeader>

      {info && <div className="mb-4 text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-4 py-2">{info}</div>}

      <div className="grid grid-cols-5 gap-4 mb-6">
        <StatCard label="Emails Sent"  value={sent.length}    icon={Send}          color="slate" />
        <StatCard label="Opens"        value={totalOpens}     sub={sent.length ? Math.round(totalOpens/sent.length*100)+'% rate' : ''} icon={Eye} color="blue" />
        <StatCard label="Clicks"       value={totalClicks}    sub={sent.length ? Math.round(totalClicks/sent.length*100)+'% CTR' : ''}  icon={MousePointer} color="amber" />
        <StatCard label="Replies"      value={replied}        sub={sent.length ? Math.round(replied/sent.length*100)+'% rate' : ''}     icon={MessageSquare} color="emerald" />
        <StatCard label="Bounced"      value={bounced}        sub={sent.length ? Math.round(bounced/sent.length*100)+'%' : ''}          icon={Send} color="red" />
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              {['Name','Email','Company','Stage','Opens','Clicks','Last Sent','Actions'].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sent.length === 0 ? (
              <tr><td colSpan={8}><Empty icon={Send} title="No sent emails yet" sub="Run a campaign to start tracking" /></td></tr>
            ) : sent.map(l => (
              <tr key={l.id} className={`table-row ${l.status==='BOUNCED'?'opacity-60':''}`}>
                <td className="px-4 py-3 font-semibold text-slate-900">{l.name}</td>
                <td className="px-4 py-3 text-slate-500 font-mono text-xs">{l.email}</td>
                <td className="px-4 py-3 text-slate-600">{l.company || '—'}</td>
                <td className="px-4 py-3">
                  <span className={`badge text-[11px] ${
                    l.status==='BOUNCED' ? 'bg-red-100 text-red-600' :
                    l.status==='REPLIED' ? 'bg-emerald-100 text-emerald-700' :
                    'bg-blue-100 text-blue-700'
                  }`}>{l.status==='BOUNCED' ? '⚡ Bounced' : (l.pipelineStage || '—')}</span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-blue-600 w-6 text-right">{l.opens || 0}</span>
                    <div className="flex-1 h-1.5 bg-slate-100 rounded-full min-w-[60px]">
                      <div className="h-full bg-blue-400 rounded-full" style={{ width: `${Math.min((l.opens||0)*15, 100)}%` }} />
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-amber-600 w-6 text-right">{l.clicks || 0}</span>
                    <div className="flex-1 h-1.5 bg-slate-100 rounded-full min-w-[60px]">
                      <div className="h-full bg-amber-400 rounded-full" style={{ width: `${Math.min((l.clicks||0)*20, 100)}%` }} />
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-slate-400 text-xs">{fmtDate(l.lastSent)}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-1">
                    {l.status !== 'BOUNCED' && l.status !== 'REPLIED' && (
                      <Btn variant="secondary" size="sm" onClick={() => markReplied(l.id)}>✓ Replied</Btn>
                    )}
                    <Btn variant="ghost" size="sm" onClick={() => viewEvents(l.id)}>📋 Events</Btn>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedLead && (
        <div className="card mt-6 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 bg-slate-50">
            <h3 className="text-sm font-bold text-slate-900">
              📋 Event Log — {leads.find(l=>l.id===selectedLead)?.name}
            </h3>
            <button className="text-slate-400 hover:text-slate-600 text-lg leading-none" onClick={()=>setSelectedLead(null)}>✕</button>
          </div>
          {eventLog.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-400">No tracking events yet. Opens and clicks appear here in real-time.</div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  {['Event','Timestamp','IP Address','Device / Browser'].map(h=>(
                    <th key={h} className="px-4 py-2 text-left font-bold text-slate-500 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {eventLog.map((e,i)=>(
                  <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-2.5">
                      <span className={`badge text-[11px] ${e.event_type==='open'?'bg-blue-100 text-blue-700':'bg-amber-100 text-amber-700'}`}>
                        {e.event_type==='open'?'👁 Opened':'🖱 Clicked'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-slate-600 font-mono">{new Date(parseInt(e.created_at)).toLocaleString('en-IN')}</td>
                    <td className="px-4 py-2.5 text-slate-500 font-mono">{e.ip || '—'}</td>
                    <td className="px-4 py-2.5 text-slate-600">{parseBrowser(e.user_agent)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}
