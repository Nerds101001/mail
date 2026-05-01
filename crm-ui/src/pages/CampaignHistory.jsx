import { useState, useEffect } from 'react'
import { PageHeader, Empty, Btn, Card, toast } from '../components/ui'
import { fmtDate } from '../utils'
import { History, ChevronDown, ChevronRight, Send, Eye, MousePointer, AlertCircle } from 'lucide-react'

function parseBrowser(ua) {
  if (!ua || ua === '—') return '—'
  let os = 'Unknown'
  if (/Windows NT 1[01]/.test(ua))      os = 'Windows 10/11'
  else if (/Windows NT 6\.[13]/.test(ua)) os = 'Windows 7/8'
  else if (/Macintosh|Mac OS X/.test(ua)) os = 'macOS'
  else if (/iPhone/.test(ua))             os = 'iOS'
  else if (/iPad/.test(ua))               os = 'iPadOS'
  else if (/Android/.test(ua))            os = 'Android'
  else if (/Linux/.test(ua))              os = 'Linux'
  let br = 'Browser'
  if (/Edg\//.test(ua))              br = 'Edge'
  else if (/OPR\/|Opera/.test(ua))   br = 'Opera'
  else if (/Firefox\//.test(ua))     br = 'Firefox'
  else if (/Chrome\//.test(ua))      br = 'Chrome'
  else if (/Safari\//.test(ua))      br = 'Safari'
  return `${br} / ${os}`
}

export default function CampaignHistory() {
  const [campaigns, setCampaigns] = useState([])
  const [loading, setLoading]     = useState(true)
  const [expanded, setExpanded]   = useState(null)
  const [detail, setDetail]       = useState(null)
  const [trackingData, setTrackingData] = useState({})
  const [viewingEmail, setViewingEmail]   = useState(null)
  const [modalEvents, setModalEvents]     = useState([])
  const [modalEventsLoading, setModalEventsLoading] = useState(false)
  const [modalTab, setModalTab]           = useState('body') // 'body' | 'events'

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
              const trackingRes = await fetch(`/api/ops?type=tracking&ids=${leadIds}&campaignId=${id}`)
              if (trackingRes.ok) {
                const tracking = await trackingRes.json()
                setTrackingData(tracking)
                console.log('📊 [CAMPAIGN] Loaded tracking data:', tracking)
              } else {
                console.error('Failed to load tracking data')
                setTrackingData({})
              }
            } catch (trackingError) {
              console.error('Failed to load tracking data:', trackingError)
              setTrackingData({})
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

  async function openEmailModal(l) {
    setViewingEmail(l)
    setModalEvents([])
    setModalTab('body')
    setModalEventsLoading(true)
    try {
      const res = await fetch(`/api/ops?type=events&leadId=${l.lead_id}`)
      if (res.ok) { const d = await res.json(); setModalEvents(d.events || []) }
    } catch(e) {}
    setModalEventsLoading(false)
  }

  const statusColor = {
    sent:        'bg-blue-100 text-blue-700',
    failed:      'bg-red-100 text-red-700',
    skipped:     'bg-slate-100 text-slate-500',
    opened:      'bg-emerald-100 text-emerald-700',
    clicked:     'bg-amber-100 text-amber-700',
    replied:     'bg-purple-100 text-purple-700',
    bounced:     'bg-red-100 text-red-600',
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
                <Btn variant="ghost" size="sm" onClick={e => { e.stopPropagation(); window.location.href = `/campaign?followup=${c.id}` }}
                  title="Re-target leads from this campaign that had zero opens">↩ Follow Up</Btn>
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
                  {/* Enhanced stats with tracking data */}
                  {expanded === c.id && detail && Object.keys(trackingData).length > 0 && (
                    <>
                      <div className="flex items-center gap-1.5 text-emerald-600">
                        <Eye size={13} />
                        <span className="font-bold">
                          {Object.values(trackingData).reduce((sum, t) => sum + (t.opens || 0), 0)}
                        </span>
                        <span className="text-slate-400 text-xs">opens</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-amber-600">
                        <MousePointer size={13} />
                        <span className="font-bold">
                          {Object.values(trackingData).reduce((sum, t) => sum + (t.clicks || 0), 0)}
                        </span>
                        <span className="text-slate-400 text-xs">clicks</span>
                      </div>
                    </>
                  )}
                  {/* Fallback to original stats if no tracking data */}
                  {(!expanded || !detail || Object.keys(trackingData).length === 0) && (
                    <>
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
                    </>
                  )}
                </div>
              </div>

              {/* Expanded detail */}
              {expanded === c.id && detail && (
                <div className="border-t border-slate-100">

                  {/* Campaign Brief + Variants summary */}
                  {(detail.brief?.product || detail.variants?.length > 0) && (
                    <div className="px-5 py-4 bg-slate-50 border-b border-slate-100 grid grid-cols-2 gap-6">
                      {detail.brief?.product && (
                        <div>
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Campaign Brief</p>
                          <div className="space-y-1 text-xs text-slate-600">
                            {detail.brief.product      && <div><span className="font-semibold text-slate-700">Product:</span> {detail.brief.product}</div>}
                            {detail.brief.industries   && <div><span className="font-semibold text-slate-700">Industries:</span> {detail.brief.industries}</div>}
                            {detail.brief.problems     && <div><span className="font-semibold text-slate-700">Problems:</span> {detail.brief.problems}</div>}
                            {detail.brief.solutions    && <div><span className="font-semibold text-slate-700">Solutions:</span> {detail.brief.solutions}</div>}
                            {detail.brief.technologies && <div><span className="font-semibold text-slate-700">Tech/USP:</span> {detail.brief.technologies}</div>}
                          </div>
                        </div>
                      )}
                      {detail.variants?.length > 0 && (
                        <div>
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">AI Variants Used ({detail.variants.length})</p>
                          <div className="space-y-1 max-h-32 overflow-y-auto">
                            {detail.variants.map((v, vi) => {
                              // count how many leads got this variant
                              const used = detail.leads?.filter(l => (l.variant_index ?? 0) === vi).length || 0
                              const opens  = detail.leads?.filter(l => (l.variant_index ?? 0) === vi).reduce((s,l) => s + (trackingData[l.lead_id]?.opens||0), 0) || 0
                              const clicks = detail.leads?.filter(l => (l.variant_index ?? 0) === vi).reduce((s,l) => s + (trackingData[l.lead_id]?.clicks||0), 0) || 0
                              return (
                                <div key={vi} className="flex items-center gap-2 text-xs">
                                  <span className="w-5 h-5 flex items-center justify-center bg-slate-200 rounded-full text-[10px] font-bold text-slate-600 shrink-0">{vi+1}</span>
                                  <span className="text-slate-700 font-medium truncate flex-1" title={v.subject}>{v.subject}</span>
                                  <span className="text-slate-400 shrink-0">{used} sent</span>
                                  {opens > 0  && <span className="text-blue-500 shrink-0">{opens} opens</span>}
                                  {clicks > 0 && <span className="text-amber-500 shrink-0">{clicks} clicks</span>}
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Lead table */}
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200">
                        {['Name','Email','Company','Status','Variant #','Subject','Sent At','Actions'].map(h => (
                          <th key={h} className="px-4 py-2 text-left font-bold text-slate-500 uppercase tracking-wide">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {detail.leads?.length === 0 ? (
                        <tr><td colSpan={8} className="px-4 py-6 text-center text-slate-400">No lead details recorded</td></tr>
                      ) : detail.leads?.map((l, i) => {
                        const enhancedStatus = getEnhancedStatus(l)
                        const leadTracking   = trackingData[l.lead_id]
                        const varNum         = (l.variant_index ?? 0) + 1
                        return (
                          <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                            <td className="px-4 py-2 font-semibold text-slate-800">{l.lead_name || '—'}</td>
                            <td className="px-4 py-2 text-slate-500 font-mono text-[11px]">{l.lead_email}</td>
                            <td className="px-4 py-2 text-slate-600">{l.lead_company || '—'}</td>
                            <td className="px-4 py-2">
                              <div className="flex items-center gap-2">
                                <span className={`badge text-[10px] ${statusColor[enhancedStatus.status] || 'bg-slate-100 text-slate-600'}`}>
                                  {enhancedStatus.display}
                                </span>
                                {leadTracking && (leadTracking.opens > 0 || leadTracking.clicks > 0) && (
                                  <div className="flex items-center gap-1 text-[10px] text-slate-400">
                                    {leadTracking.opens  > 0 && <span className="flex items-center gap-0.5"><Eye size={9}/>{leadTracking.opens}</span>}
                                    {leadTracking.clicks > 0 && <span className="flex items-center gap-0.5"><MousePointer size={9}/>{leadTracking.clicks}</span>}
                                  </div>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-2 text-center">
                              <span className="w-5 h-5 inline-flex items-center justify-center bg-emerald-100 text-emerald-700 rounded-full text-[10px] font-bold">{varNum}</span>
                            </td>
                            <td className="px-4 py-2 text-slate-500 max-w-[180px] truncate">{l.subject || '—'}</td>
                            <td className="px-4 py-2 text-slate-400">{l.sent_at ? new Date(parseInt(l.sent_at)).toLocaleTimeString('en-IN') : '—'}</td>
                            <td className="px-4 py-2">
                              <button onClick={() => openEmailModal(l)} className="text-blue-600 hover:text-blue-700 text-xs font-medium flex items-center gap-1">
                                <Eye size={12}/> View
                              </button>
                            </td>
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

      {/* Email Detail Modal — Body + Events tabs */}
      {viewingEmail && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setViewingEmail(null)}>
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
              <div>
                <h3 className="text-sm font-bold text-slate-900">{viewingEmail.lead_name}</h3>
                <p className="text-xs text-slate-500 font-mono">{viewingEmail.lead_email}</p>
              </div>
              <div className="flex items-center gap-4">
                {/* Engagement badges */}
                {(trackingData[viewingEmail.lead_id]?.opens > 0 || trackingData[viewingEmail.lead_id]?.clicks > 0) && (
                  <div className="flex gap-2 text-xs">
                    <span className="flex items-center gap-1 bg-blue-50 text-blue-700 px-2 py-1 rounded-lg">
                      <Eye size={11}/>{trackingData[viewingEmail.lead_id]?.opens||0} opens
                    </span>
                    <span className="flex items-center gap-1 bg-amber-50 text-amber-700 px-2 py-1 rounded-lg">
                      <MousePointer size={11}/>{trackingData[viewingEmail.lead_id]?.clicks||0} clicks
                    </span>
                  </div>
                )}
                <button onClick={() => setViewingEmail(null)} className="text-slate-400 hover:text-slate-600 text-xl leading-none">✕</button>
              </div>
            </div>
            {/* Tabs */}
            <div className="flex border-b border-slate-200 px-5">
              {['body','events'].map(t => (
                <button key={t} onClick={() => setModalTab(t)}
                  className={`py-2.5 px-4 text-xs font-semibold border-b-2 transition-colors capitalize ${modalTab===t ? 'border-emerald-500 text-emerald-700' : 'border-transparent text-slate-400 hover:text-slate-600'}`}>
                  {t === 'body' ? '📧 Email Body' : `📋 Events${modalEvents.length > 0 ? ` (${modalEvents.length})` : ''}`}
                </button>
              ))}
            </div>
            {/* Content */}
            <div className="overflow-y-auto flex-1 p-5">
              {modalTab === 'body' ? (
                <div>
                  <div className="mb-4">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Subject</p>
                    <p className="text-sm font-semibold text-slate-900">{viewingEmail.subject || '— no subject recorded —'}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Email Body</p>
                    <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
                      {viewingEmail.body
                        ? <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">{viewingEmail.body}</p>
                        : <p className="text-sm text-slate-400 text-center py-6">Body not recorded for this send.<br/><span className="text-xs">New campaigns save full body content.</span></p>
                      }
                    </div>
                  </div>
                </div>
              ) : (
                <div>
                  {modalEventsLoading ? (
                    <p className="text-sm text-slate-400 text-center py-8">Loading events...</p>
                  ) : modalEvents.length === 0 ? (
                    <div className="text-center py-8">
                      <p className="text-sm text-slate-500 font-medium">No tracking events yet</p>
                      <p className="text-xs text-slate-400 mt-1">Opens and clicks appear here when the recipient interacts with the email.</p>
                    </div>
                  ) : (
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200">
                          {['Event','Time','IP Address','Device / Browser','URL'].map(h => (
                            <th key={h} className="px-3 py-2 text-left font-bold text-slate-500 uppercase tracking-wide">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {modalEvents.map((e, i) => {
                          const clickUrl = e.event_type === 'click' && e.target_url && !e.target_url.startsWith('campaign:') ? e.target_url : null
                          return (
                            <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                              <td className="px-3 py-2">
                                <span className={`badge text-[10px] ${e.event_type==='open' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}`}>
                                  {e.event_type==='open' ? '👁 Opened' : '🖱 Clicked'}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-slate-600 font-mono whitespace-nowrap">{new Date(parseInt(e.created_at)).toLocaleString('en-IN')}</td>
                              <td className="px-3 py-2 text-slate-500 font-mono">{e.ip || '—'}</td>
                              <td className="px-3 py-2 text-slate-600">{parseBrowser(e.user_agent)}</td>
                              <td className="px-3 py-2 text-slate-500 max-w-[160px]">
                                {clickUrl
                                  ? <a href={clickUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline truncate block" title={clickUrl}>{clickUrl.replace(/^https?:\/\//,'').substring(0,40)}…</a>
                                  : '—'}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
