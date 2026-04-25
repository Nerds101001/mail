import { useState, useEffect } from 'react'
import { PageHeader, Empty, Btn, Card, toast } from '../components/ui'
import { fmtDate } from '../utils'
import { History, ChevronDown, ChevronRight, Send, Eye, MousePointer, UserX, AlertCircle } from 'lucide-react'

export default function CampaignHistory() {
  const [campaigns, setCampaigns] = useState([])
  const [loading, setLoading]     = useState(true)
  const [expanded, setExpanded]   = useState(null)
  const [detail, setDetail]       = useState(null)
  const [trackingData, setTrackingData] = useState({})

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const res = await fetch('/api/campaigns')
      if (res.ok) setCampaigns(await res.json())
    } catch(e) { toast('Could not load history', 'error') }
    setLoading(false)
  }

  async function expand(id) {
    if (expanded === id) { setExpanded(null); setDetail(null); setTrackingData({}); return }
    setExpanded(id)
    try {
      const res = await fetch(`/api/campaigns?id=${id}`)
      if (res.ok) {
        const campaignDetail = await res.json()
        setDetail(campaignDetail)
        
        // Fetch tracking data for all leads in this campaign
        if (campaignDetail.leads?.length > 0) {
          const leadIds = campaignDetail.leads.map(l => l.lead_id).filter(Boolean).join(',')
          if (leadIds) {
            try {
              const trackingRes = await fetch(`/api/tracking-stats?ids=${leadIds}`)
              if (trackingRes.ok) {
                const tracking = await trackingRes.json()
                setTrackingData(tracking)
                console.log('📊 [CAMPAIGN] Loaded tracking data:', tracking)
              }
            } catch (trackingError) {
              console.error('Failed to load tracking data:', trackingError)
            }
          }
        }
      }
    } catch(e) {
      console.error('Failed to load campaign details:', e)
    }
  }

  // Enhanced status logic with tracking data
  function getEnhancedStatus(lead) {
    const leadTracking = trackingData[lead.lead_id]
    if (leadTracking) {
      if (leadTracking.clicks > 0) {
        return { status: 'clicked', display: `clicked ${leadTracking.clicks}x` }
      }
      if (leadTracking.opens > 0) {
        return { status: 'opened', display: `opened ${leadTracking.opens}x` }
      }
    }
    return { status: lead.status, display: lead.status }
  }

  const statusColor = {
    sent:        'bg-blue-100 text-blue-700',
    failed:      'bg-red-100 text-red-700',
    skipped:     'bg-slate-100 text-slate-500',
    opened:      'bg-emerald-100 text-emerald-700',
    clicked:     'bg-amber-100 text-amber-700',
    unsubscribed:'bg-slate-100 text-slate-400',
  }

  return (
    <div>
      <PageHeader title="Campaign History" subtitle="All past campaign runs with full stats">
        <Btn variant="secondary" size="sm" onClick={load}>↻ Refresh</Btn>
      </PageHeader>

      {loading ? (
        <div className="card p-16 text-center text-sm text-slate-400">Loading...</div>
      ) : campaigns.length === 0 ? (
        <div className="card p-16">
          <Empty icon={History} title="No campaigns yet" sub="Run your first campaign to see history here" />
        </div>
      ) : (
        <div className="space-y-3">
          {campaigns.map(c => (
            <div key={c.id} className="card overflow-hidden">
              {/* Campaign row */}
              <div
                className="flex items-center gap-4 px-5 py-4 cursor-pointer hover:bg-slate-50 transition-colors"
                onClick={() => expand(c.id)}
              >
                <div className="text-slate-400">
                  {expanded === c.id ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                </div>
                <div className="flex-1">
                  <p className="text-sm font-bold text-slate-900">{c.name}</p>
                  <p className="text-xs text-slate-400">{fmtDate(new Date(parseInt(c.created_at)).toISOString())} · Target: {c.target} · Sender: {c.sender}</p>
                </div>
                <div className="flex items-center gap-4 text-sm">
                  <div className="flex items-center gap-1.5 text-blue-600">
                    <Send size={13} /><span className="font-bold">{c.total_sent}</span><span className="text-slate-400 text-xs">sent</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-red-500">
                    <AlertCircle size={13} /><span className="font-bold">{c.total_failed}</span><span className="text-slate-400 text-xs">failed</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-slate-400">
                    <span className="font-bold">{c.total_skipped}</span><span className="text-xs">skipped</span>
                  </div>
                  {c.stats?.opens > 0 && (
                    <div className="flex items-center gap-1.5 text-emerald-600">
                      <Eye size={13} /><span className="font-bold">{c.stats.opens}</span>
                    </div>
                  )}
                  {c.stats?.clicks > 0 && (
                    <div className="flex items-center gap-1.5 text-amber-600">
                      <MousePointer size={13} /><span className="font-bold">{c.stats.clicks}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Expanded lead list */}
              {expanded === c.id && detail && (
                <div className="border-t border-slate-100">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200">
                        {['Name','Email','Company','Status','Subject','Sent At'].map(h => (
                          <th key={h} className="px-4 py-2 text-left font-bold text-slate-500 uppercase tracking-wide">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {detail.leads?.length === 0 ? (
                        <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-400">No lead details recorded</td></tr>
                      ) : detail.leads?.map((l, i) => {
                        const enhancedStatus = getEnhancedStatus(l)
                        const leadTracking = trackingData[l.lead_id]
                        
                        return (
                          <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                            <td className="px-4 py-2 font-semibold text-slate-800">{l.lead_name || '—'}</td>
                            <td className="px-4 py-2 text-slate-500 font-mono">{l.lead_email}</td>
                            <td className="px-4 py-2 text-slate-600">{l.lead_company || '—'}</td>
                            <td className="px-4 py-2">
                              <div className="flex items-center gap-2">
                                <span className={`badge text-[10px] ${statusColor[enhancedStatus.status] || 'bg-slate-100 text-slate-600'}`}>
                                  {enhancedStatus.display}
                                </span>
                                {leadTracking && (leadTracking.opens > 0 || leadTracking.clicks > 0) && (
                                  <div className="flex items-center gap-1 text-xs text-slate-400">
                                    {leadTracking.opens > 0 && (
                                      <span className="flex items-center gap-1">
                                        <Eye size={10} />{leadTracking.opens}
                                      </span>
                                    )}
                                    {leadTracking.clicks > 0 && (
                                      <span className="flex items-center gap-1">
                                        <MousePointer size={10} />{leadTracking.clicks}
                                      </span>
                                    )}
                                  </div>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-2 text-slate-500 max-w-[200px] truncate">{l.subject || '—'}</td>
                            <td className="px-4 py-2 text-slate-400">{l.sent_at ? new Date(parseInt(l.sent_at)).toLocaleTimeString('en-IN') : '—'}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
