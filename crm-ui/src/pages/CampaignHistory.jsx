import { useState, useEffect, useRef } from 'react'
import { useCRM } from '../store'
import { PageHeader, Empty, Btn, Card, toast } from '../components/ui'
import { fmtDate } from '../utils'
import {
  History, ChevronDown, ChevronRight, Send, Eye, MousePointer,
  AlertCircle, Trash2, Calendar, Clock, Pencil, Check, Pause, Play, Zap,
} from 'lucide-react'
import * as campaignRunner from '../campaignRunner'

const STATUS_COLOR = {
  PENDING:      'bg-yellow-100 text-yellow-700',
  pending:      'bg-yellow-100 text-yellow-700',
  sent:         'bg-blue-100 text-blue-700',
  SENT:         'bg-blue-100 text-blue-700',
  failed:       'bg-red-100 text-red-700',
  FAILED:       'bg-red-100 text-red-700',
  skipped:      'bg-slate-100 text-slate-500',
  SKIPPED:      'bg-slate-100 text-slate-500',
  opened:       'bg-emerald-100 text-emerald-700',
  clicked:      'bg-amber-100 text-amber-700',
  replied:      'bg-purple-100 text-purple-700',
  bounced:      'bg-red-100 text-red-600',
  BOUNCED:      'bg-red-100 text-red-600',
  unsubscribed: 'bg-slate-100 text-slate-400',
}

function parseBrowser(ua) {
  if (!ua || ua === '—') return '—'
  let os = 'Unknown'
  if (/Windows NT 1[01]/.test(ua))       os = 'Windows 10/11'
  else if (/Windows NT 6\.[13]/.test(ua)) os = 'Windows 7/8'
  else if (/Macintosh|Mac OS X/.test(ua)) os = 'macOS'
  else if (/iPhone/.test(ua))             os = 'iOS'
  else if (/iPad/.test(ua))               os = 'iPadOS'
  else if (/Android/.test(ua))            os = 'Android'
  else if (/Linux/.test(ua))              os = 'Linux'
  let br = 'Browser'
  if (/Edg\//.test(ua))             br = 'Edge'
  else if (/OPR\/|Opera/.test(ua))  br = 'Opera'
  else if (/Firefox\//.test(ua))    br = 'Firefox'
  else if (/Chrome\//.test(ua))     br = 'Chrome'
  else if (/Safari\//.test(ua))     br = 'Safari'
  return `${br} / ${os}`
}

// ── Edit Scheduled Campaign Modal ─────────────────────────────────────────────
function EditScheduledModal({ campaign, onClose, onSaved }) {
  const sc = campaign.schedule_config || {}
  const [name, setName]           = useState(campaign.name || '')
  const [schedTime, setSchedTime] = useState(() => {
    if (!campaign.scheduled_at) return ''
    const d   = new Date(parseInt(campaign.scheduled_at))
    const pad = n => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  })
  const [variants, setVariants] = useState(() =>
    (campaign.variants || []).map(v => ({ ...v }))
  )
  const [saving, setSaving] = useState(false)
  const authHdr = () => ({ Authorization: `Bearer ${localStorage.getItem('crm_token') || ''}` })

  async function save() {
    if (!schedTime) { toast('Pick a date/time', 'error'); return }
    const scheduledAt = new Date(schedTime).getTime()
    if (scheduledAt <= Date.now()) { toast('Time must be in the future', 'error'); return }
    setSaving(true)
    try {
      const res = await fetch(`/api/crm?type=campaigns&id=${campaign.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHdr() },
        body:    JSON.stringify({ name, scheduled_at: scheduledAt, schedule_config: { ...sc, variants }, variants }),
      })
      if (!res.ok) throw new Error('Save failed')
      toast('Campaign updated ✓', 'success')
      onSaved({ ...campaign, name, scheduled_at: scheduledAt, variants })
    } catch(err) {
      toast('Could not save: ' + err.message, 'error')
    }
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
         onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col"
           onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <Calendar size={16} className="text-amber-500" />
            <h3 className="text-sm font-bold text-slate-900">Edit Scheduled Campaign</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">✕</button>
        </div>

        <div className="overflow-y-auto flex-1 p-5 space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Campaign Name</label>
              <input className="input w-full" value={name} onChange={e => setName(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Scheduled Date &amp; Time</label>
              <input type="datetime-local" className="input w-full" value={schedTime} onChange={e => setSchedTime(e.target.value)} />
            </div>
          </div>

          {variants.length > 0 && (
            <div>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">
                Email Variants ({variants.length})
              </p>
              <div className="space-y-4">
                {variants.map((v, vi) => (
                  <div key={vi} className="border border-slate-200 rounded-lg p-4 bg-slate-50">
                    <div className="flex items-center gap-2 mb-3">
                      <span className="w-5 h-5 flex items-center justify-center bg-amber-100 text-amber-700 rounded-full text-[10px] font-bold shrink-0">{vi+1}</span>
                      <span className="text-xs font-semibold text-slate-600">Variant {vi+1}</span>
                    </div>
                    <div className="space-y-2">
                      <div>
                        <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1 block">Subject</label>
                        <input
                          className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-amber-400/30"
                          value={v.subject || ''}
                          onChange={e => setVariants(vs => vs.map((x, i) => i === vi ? { ...x, subject: e.target.value } : x))}
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1 block">Body</label>
                        <textarea
                          rows={6}
                          className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-amber-400/30 resize-y leading-relaxed"
                          value={v.body || ''}
                          onChange={e => setVariants(vs => vs.map((x, i) => i === vi ? { ...x, body: e.target.value } : x))}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-slate-200 bg-slate-50 rounded-b-xl">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800 font-medium">Cancel</button>
          <Btn variant="primary" onClick={save} disabled={saving}>
            {saving ? '⏳ Saving...' : <><Check size={13}/> Save Changes</>}
          </Btn>
        </div>
      </div>
    </div>
  )
}

// ── Campaign row — defined outside to avoid Fast Refresh issues ───────────────
function CampaignRow({ c, isScheduled, isPaused, isInterrupted, expanded, detail, trackingData, onExpand, onEdit, onCancel, onDelete, onViewEmail, onResume, runnerState }) {
  const scheduledDate = c.scheduled_at
    ? new Date(parseInt(c.scheduled_at)).toLocaleString('en-IN', { dateStyle:'medium', timeStyle:'short' })
    : null
  const isExpanded = expanded === c.id

  // Live runner stats for this campaign (if it's the one currently running)
  const isLive = runnerState?.status === 'RUNNING' && runnerState.campaignId === c.id
  const liveSent   = isLive ? runnerState.sent    : (c.total_sent    || 0)
  const liveFailed = isLive ? runnerState.failed  : (c.total_failed  || 0)
  const liveSkip   = isLive ? runnerState.skipped : (c.total_skipped || 0)

  // Resume button logic
  // Cap-paused (daily limit hit) → 24 h gate so limits actually reset
  // Manually paused → resume available immediately, no waiting
  const capPause    = c.schedule_config?.cap_pause || false
  const pausedAt    = c.schedule_config?.paused_at
  const pendingCount = c.schedule_config?.pending_count || 0
  const resumeReady = capPause
    ? (pausedAt && Date.now() - pausedAt >= 24 * 60 * 60 * 1000)
    : true   // manual pause → always resumable
  const hoursLeft = (capPause && pausedAt)
    ? Math.max(0, Math.ceil((24 * 60 * 60 * 1000 - (Date.now() - pausedAt)) / (60 * 60 * 1000)))
    : 0

  return (
    <div className={`card overflow-hidden ${
      isInterrupted ? 'border-2 border-purple-300 bg-purple-50/40'
      : isScheduled && !isPaused ? 'border-2 border-amber-300 bg-amber-50/40'
      : isPaused ? 'border-2 border-orange-300 bg-orange-50/40'
      : ''
    }`}>
      {/* Header row */}
      <div
        className={`flex items-center gap-4 px-5 py-4 cursor-pointer transition-colors ${
          isInterrupted ? 'hover:bg-purple-50/80'
          : isScheduled && !isPaused ? 'hover:bg-amber-50/80'
          : isPaused ? 'hover:bg-orange-50/80'
          : 'hover:bg-slate-50'
        }`}
        onClick={() => onExpand(c.id)}
      >
        <div className="text-slate-400">
          {isExpanded ? <ChevronDown size={16}/> : <ChevronRight size={16}/>}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-bold text-slate-900 truncate">{c.name}</p>
            {isScheduled && c.status === 'SCHEDULED' && (
              <span className="flex items-center gap-1 text-[10px] font-bold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full whitespace-nowrap">
                <Clock size={9}/> SCHEDULED
              </span>
            )}
            {c.status === 'RUNNING' && !isInterrupted && (
              <span className="flex items-center gap-1 text-[10px] font-bold bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full whitespace-nowrap animate-pulse">
                ▶ RUNNING {isLive && `· ${runnerState.progress}%`}
              </span>
            )}
            {isInterrupted && (
              <span className="flex items-center gap-1 text-[10px] font-bold bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full whitespace-nowrap">
                <Zap size={9}/> INTERRUPTED
              </span>
            )}
            {isPaused && (
              <span className="flex items-center gap-1 text-[10px] font-bold bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full whitespace-nowrap">
                <Pause size={9}/> PAUSED · {pendingCount} pending
              </span>
            )}
            {c.status === 'CANCELLED' && (
              <span className="text-[10px] font-bold bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">CANCELLED</span>
            )}
            {c.status === 'FAILED' && (
              <span className="text-[10px] font-bold bg-red-100 text-red-600 px-2 py-0.5 rounded-full">FAILED</span>
            )}
          </div>
          {isInterrupted ? (
            <p className="text-xs text-purple-700 font-medium mt-0.5">
              ⚡ Crashed or page refreshed · {c.total_sent || 0} sent · remaining leads queued in DB · {c.target} · {c.sender}
            </p>
          ) : isScheduled && !isPaused && scheduledDate ? (
            <p className="text-xs text-amber-700 font-medium mt-0.5">
              🕐 Runs at {scheduledDate} · Target: {c.target} · Sender: {c.sender}
            </p>
          ) : isPaused ? (
            <p className="text-xs text-orange-700 font-medium mt-0.5">
              {c.schedule_config?.cap_pause ? '🚫 Daily limit hit' : '⏸ Manually paused'}
              {pausedAt ? ` · ${new Date(pausedAt).toLocaleString('en-IN', { dateStyle:'short', timeStyle:'short' })}` : ''}
              {' '}· {c.target} · {c.sender}
            </p>
          ) : (
            <p className="text-xs text-slate-400">
              {fmtDate(new Date(parseInt(c.created_at)).toISOString())} · Target: {c.target} · Sender: {c.sender}
            </p>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1.5 shrink-0">
          {isInterrupted && (
            <Btn variant="primary" size="sm"
              onClick={e => { e.stopPropagation(); onResume(c) }}
              title="Resume from last checkpoint">
              <Play size={12}/> Resume
            </Btn>
          )}
          {isScheduled && c.status === 'SCHEDULED' && (
            <>
              <Btn variant="ghost" size="sm" onClick={e => { e.stopPropagation(); onEdit(c) }} title="Edit schedule time or content">
                <Pencil size={12}/> Edit
              </Btn>
              <button
                onClick={e => onCancel(c, e)}
                className="px-2 py-1 text-xs text-amber-600 hover:text-amber-700 hover:bg-amber-100 rounded-lg transition-colors font-medium"
              >
                ✕ Cancel
              </button>
            </>
          )}
          {isPaused && (
            <>
              {resumeReady ? (
                <Btn variant="primary" size="sm" onClick={e => { e.stopPropagation(); onResume(c) }} title="Resume sending pending leads">
                  <Play size={12}/> Resume
                </Btn>
              ) : (
                <span className="text-[10px] text-orange-600 bg-orange-100 px-2 py-1 rounded-lg font-medium" title="Available after daily limits reset (24 h)">
                  Limit reset in {hoursLeft}h
                </span>
              )}
            </>
          )}
          {!isScheduled && !isPaused && !isInterrupted && (
            <Btn variant="ghost" size="sm" onClick={e => { e.stopPropagation(); window.location.href = `/campaign?followup=${c.id}` }}
              title="Re-target zero-open leads">
              ↩ Follow Up
            </Btn>
          )}
          <button onClick={e => onDelete(c, e)} title="Delete" className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
            <Trash2 size={14}/>
          </button>
        </div>

        {/* Stats */}
        {(!isScheduled || isPaused || c.status === 'RUNNING') && (
          <div className="flex items-center gap-4 text-sm shrink-0">
            <div className="flex items-center gap-1.5 text-blue-600">
              <Send size={13}/><span className="font-bold">{liveSent}</span><span className="text-slate-400 text-xs">sent</span>
            </div>
            <div className="flex items-center gap-1.5 text-red-500">
              <AlertCircle size={13}/><span className="font-bold">{liveFailed}</span><span className="text-slate-400 text-xs">failed</span>
            </div>
            {(liveSkip > 0 || isPaused) && (
              <div className="flex items-center gap-1.5 text-slate-400">
                <span className="font-bold">{liveSkip}</span><span className="text-xs">skipped</span>
              </div>
            )}
            {isPaused && pendingCount > 0 && (
              <div className="flex items-center gap-1.5 text-orange-500">
                <span className="font-bold">{pendingCount}</span><span className="text-xs">pending</span>
              </div>
            )}
            {isExpanded && detail && Object.keys(trackingData).length > 0 && (
              <>
                <div className="flex items-center gap-1.5 text-emerald-600">
                  <Eye size={13}/>
                  <span className="font-bold">{Object.values(trackingData).reduce((s, t) => s + (t.opens||0), 0)}</span>
                  <span className="text-slate-400 text-xs">opens</span>
                </div>
                <div className="flex items-center gap-1.5 text-amber-600">
                  <MousePointer size={13}/>
                  <span className="font-bold">{Object.values(trackingData).reduce((s, t) => s + (t.clicks||0), 0)}</span>
                  <span className="text-slate-400 text-xs">clicks</span>
                </div>
              </>
            )}
            {(!isExpanded || !detail || Object.keys(trackingData).length === 0) && !isPaused && (
              <>
                {c.stats?.opens  > 0 && <div className="flex items-center gap-1.5 text-emerald-600"><Eye size={13}/><span className="font-bold">{c.stats.opens}</span></div>}
                {c.stats?.clicks > 0 && <div className="flex items-center gap-1.5 text-amber-600"><MousePointer size={13}/><span className="font-bold">{c.stats.clicks}</span></div>}
              </>
            )}
          </div>
        )}

        {isScheduled && !isPaused && c.status !== 'RUNNING' && (
          <div className="text-xs text-slate-400 shrink-0">
            {c.variants?.length || 0} variant{c.variants?.length !== 1 ? 's' : ''}
          </div>
        )}
      </div>

      {/* Expanded detail */}
      {isExpanded && detail && (
        <div className="border-t border-slate-100">
          {/* Brief + Variants summary */}
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
                      const used   = detail.leads?.filter(l => (l.variant_index??0) === vi).length || 0
                      const opens  = detail.leads?.filter(l => (l.variant_index??0) === vi).reduce((s,l)=>s+(trackingData[l.lead_id]?.opens||0),0) || 0
                      const clicks = detail.leads?.filter(l => (l.variant_index??0) === vi).reduce((s,l)=>s+(trackingData[l.lead_id]?.clicks||0),0) || 0
                      return (
                        <div key={vi} className="flex items-center gap-2 text-xs">
                          <span className="w-5 h-5 flex items-center justify-center bg-slate-200 rounded-full text-[10px] font-bold text-slate-600 shrink-0">{vi+1}</span>
                          <span className="text-slate-700 font-medium truncate flex-1" title={v.subject}>{v.subject}</span>
                          <span className="text-slate-400 shrink-0">{used} sent</span>
                          {opens  > 0 && <span className="text-blue-500 shrink-0">{opens} opens</span>}
                          {clicks > 0 && <span className="text-amber-500 shrink-0">{clicks} clicks</span>}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Lead detail — split SENT/FAILED rows from PENDING (queued) rows */}
          {(() => {
            const allLeads    = detail.leads || []
            const sentLeads   = allLeads.filter(l => l.status !== 'PENDING')
            const pendingLeads = allLeads.filter(l => l.status === 'PENDING')
            const noRows      = allLeads.length === 0

            // Human-readable labels for each status value
            const STATUS_LABEL = {
              SENT: 'sent', FAILED: 'failed', BOUNCED: 'bounced',
              SKIPPED: 'skipped', PENDING: 'queued',
              sent: 'sent', failed: 'failed', bounced: 'bounced',
              skipped: 'skipped', pending: 'queued',
            }

            return (
              <>
                {/* Empty state */}
                {noRows && (c.status === 'SCHEDULED' || c.status === 'RUNNING' || c.status === 'CANCELLED') && (
                  <div className="px-5 py-4">
                    <p className="text-xs text-slate-500 text-center py-2">
                      {c.status === 'RUNNING'
                        ? 'Preparing to send — leads will appear here shortly…'
                        : 'No leads sent yet — campaign will execute at the scheduled time.'}
                    </p>
                  </div>
                )}

                {/* Pending summary banner */}
                {pendingLeads.length > 0 && (
                  <div className="mx-5 mt-4 mb-2 flex items-center gap-2 bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-2.5 text-xs">
                    <span className="text-yellow-600 font-bold text-sm">⏳</span>
                    <span className="text-yellow-800 font-semibold">{pendingLeads.length} leads queued</span>
                    <span className="text-yellow-600">— waiting to be sent</span>
                    <div className="ml-auto text-yellow-500 font-mono text-[10px]">
                      {pendingLeads.slice(0, 3).map(l => l.lead_email).join(', ')}
                      {pendingLeads.length > 3 ? ` +${pendingLeads.length - 3} more` : ''}
                    </div>
                  </div>
                )}

                {/* Sent / failed / skipped table */}
                {sentLeads.length > 0 && (
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200">
                        {['Name','Email','Company','Status','Variant #','Subject','Sent At',''].map(h => (
                          <th key={h} className="px-4 py-2 text-left font-bold text-slate-500 uppercase tracking-wide">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sentLeads.map((l, i) => {
                        const td     = trackingData[l.lead_id]
                        const status = td?.clicks > 0 ? { key:'clicked', label:`clicked ${td.clicks}×` }
                                     : td?.opens  > 0 ? { key:'opened',  label:`opened ${td.opens}×`  }
                                     : { key: l.status, label: STATUS_LABEL[l.status] || l.status?.toLowerCase() || '?' }
                        const varNum = (l.variant_index ?? 0) + 1
                        const sentTime = l.sent_at
                          ? new Date(parseInt(l.sent_at)).toLocaleString('en-IN', { dateStyle:'short', timeStyle:'short' })
                          : '—'
                        return (
                          <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                            <td className="px-4 py-2 font-semibold text-slate-800">{l.lead_name||'—'}</td>
                            <td className="px-4 py-2 text-slate-500 font-mono text-[11px]">{l.lead_email||'—'}</td>
                            <td className="px-4 py-2 text-slate-600">{l.lead_company||'—'}</td>
                            <td className="px-4 py-2">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className={`badge text-[10px] ${STATUS_COLOR[status.key] || 'bg-slate-100 text-slate-600'}`}>{status.label}</span>
                                {td && (td.opens > 0 || td.clicks > 0) && (
                                  <div className="flex items-center gap-1 text-[10px] text-slate-400">
                                    {td.opens  > 0 && <span className="flex items-center gap-0.5"><Eye size={9}/>{td.opens}</span>}
                                    {td.clicks > 0 && <span className="flex items-center gap-0.5"><MousePointer size={9}/>{td.clicks}</span>}
                                  </div>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-2 text-center">
                              <span className="w-5 h-5 inline-flex items-center justify-center bg-emerald-100 text-emerald-700 rounded-full text-[10px] font-bold">{varNum}</span>
                            </td>
                            <td className="px-4 py-2 text-slate-500 max-w-[200px] truncate" title={l.subject||''}>{l.subject||'—'}</td>
                            <td className="px-4 py-2 text-slate-400 whitespace-nowrap">{sentTime}</td>
                            <td className="px-4 py-2">
                              <button onClick={() => onViewEmail(l)} className="text-blue-600 hover:text-blue-700 text-xs font-medium flex items-center gap-1">
                                <Eye size={12}/> View
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </>
            )
          })()}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

export default function CampaignHistory() {
  const { viewAs } = useCRM()
  const [campaigns, setCampaigns]         = useState([])
  const [loading, setLoading]             = useState(true)
  const [expanded, setExpanded]           = useState(null)
  const [detail, setDetail]               = useState(null)
  const [trackingData, setTrackingData]   = useState({})
  const [viewingEmail, setViewingEmail]   = useState(null)
  const [modalEvents, setModalEvents]     = useState([])
  const [modalEventsLoading, setModalEventsLoading] = useState(false)
  const [modalTab, setModalTab]           = useState('body')
  const [editingCamp, setEditingCamp]     = useState(null)
  const [runnerState, setRunnerState]     = useState(campaignRunner.getState())
  const [resuming, setResuming]           = useState(null) // campaignId being resumed

  // Refs for safe async callbacks
  const mountedRef = useRef(true)
  const loadRef    = useRef(null)
  useEffect(() => () => { mountedRef.current = false }, [])

  const authHeader = () => ({ Authorization: `Bearer ${localStorage.getItem('crm_token') || ''}` })
  const vaParam    = () => viewAs ? `&viewAs=${encodeURIComponent(viewAs)}` : ''

  useEffect(() => { load() }, [viewAs]) // eslint-disable-line

  // Keep loadRef pointing at the latest load (captures current viewAs/vaParam)
  useEffect(() => { loadRef.current = load })

  // Subscribe to runner for live progress
  useEffect(() => campaignRunner.subscribe(s => {
    setRunnerState(s)
    // When runner finishes, reload to get final stats from DB
    if (s.status === 'DONE' || s.status === 'PAUSED') {
      setTimeout(() => loadRef.current?.(), 1500)
    }
  }), []) // eslint-disable-line

  // Hobby plan has no per-minute cron — trigger runner client-side instead.
  useEffect(() => {
    const dueNow = campaigns.filter(c => c.status === 'SCHEDULED' && parseInt(c.scheduled_at) <= Date.now())
    if (dueNow.length > 0) {
      fetch('/api/run-scheduled', { method: 'POST', headers: authHeader() })
        .then(() => load())
        .catch(() => {})
    }
  }, [campaigns]) // eslint-disable-line

  useEffect(() => {
    const hasScheduled = campaigns.some(c => c.status === 'SCHEDULED')
    if (!hasScheduled) return
    const timer = setInterval(() => load(), 30000)
    return () => clearInterval(timer)
  }, [campaigns]) // eslint-disable-line

  async function load() {
    setLoading(true)
    try {
      const res = await fetch(`/api/crm?type=campaigns${vaParam()}`, { headers: authHeader() })
      if (res.ok) setCampaigns(await res.json())
    } catch(e) { toast('Could not load history', 'error') }
    setLoading(false)
  }

  async function expand(id) {
    if (expanded === id) { setExpanded(null); setDetail(null); setTrackingData({}); return }
    setExpanded(id)
    try {
      const res = await fetch(`/api/crm?type=campaigns&id=${id}${vaParam()}`, { headers: authHeader() })
      if (res.ok) {
        const d = await res.json()
        setDetail(d)
        if (d.leads?.length > 0) {
          const ids = d.leads.map(l => l.lead_id).filter(Boolean).join(',')
          if (ids) {
            try {
              const tr = await fetch(`/api/ops?type=tracking&ids=${ids}&campaignId=${id}`)
              setTrackingData(tr.ok ? await tr.json() : {})
            } catch { setTrackingData({}) }
          }
        }
      }
    } catch(e) { console.error('Failed to load campaign details:', e) }
  }

  async function deleteCampaign(c, e) {
    e.stopPropagation()
    const msg = c.status === 'SCHEDULED'
      ? `Delete scheduled campaign "${c.name}"?`
      : `Delete "${c.name}"?\n\nThis removes the campaign and all send history. Cannot be undone.`
    if (!confirm(msg)) return
    try {
      const res = await fetch(`/api/crm?type=campaigns&id=${c.id}`, { method: 'DELETE', headers: authHeader() })
      if (!res.ok) throw new Error('Delete failed')
      setCampaigns(prev => prev.filter(x => x.id !== c.id))
      if (expanded === c.id) { setExpanded(null); setDetail(null) }
      toast(`"${c.name}" deleted`, 'success')
    } catch(e) { toast('Could not delete campaign', 'error') }
  }

  async function resumeCampaign(c) {
    if (runnerState.status === 'RUNNING') {
      toast('A campaign is already running — wait for it to finish or pause it first', 'error')
      return
    }
    const originalStatus = c.status  // 'PAUSED' or 'RUNNING' (interrupted)
    setResuming(c.id)
    setCampaigns(prev => prev.map(x => x.id === c.id ? { ...x, status: 'RUNNING' } : x))
    toast(`▶ Resuming "${c.name}"…`, 'info')
    try {
      await campaignRunner.resume(c, localStorage.getItem('crm_token') || '')
    } catch(e) {
      if (mountedRef.current) {
        toast('Resume failed: ' + e.message, 'error')
        setCampaigns(prev => prev.map(x => x.id === c.id ? { ...x, status: originalStatus } : x))
      }
    }
    if (mountedRef.current) setResuming(null)
  }

  async function cancelSchedule(c, e) {
    e.stopPropagation()
    if (!confirm(`Cancel "${c.name}"? The record will be kept but it will not run.`)) return
    try {
      const res = await fetch(`/api/crm?type=campaigns&id=${c.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body:    JSON.stringify({ status: 'CANCELLED' }),
      })
      if (!res.ok) throw new Error('PATCH failed')
      setCampaigns(prev => prev.map(x => x.id === c.id ? { ...x, status: 'CANCELLED' } : x))
      toast(`"${c.name}" cancelled`, 'info')
    } catch(e) { toast('Could not cancel: ' + e.message, 'error') }
  }

  async function openEmailModal(l) {
    setViewingEmail(l)
    setModalEvents([])
    setModalTab('body')
    setModalEventsLoading(true)
    try {
      const res = await fetch(`/api/ops?type=events&leadId=${l.lead_id}${expanded ? `&campaignId=${expanded}` : ''}`)
      if (res.ok) { const d = await res.json(); setModalEvents(d.events || []) }
    } catch(e) {}
    setModalEventsLoading(false)
  }

  // A campaign is "actively running" only if the in-memory runner holds it.
  // Any RUNNING campaign NOT held by the runner was interrupted (crash / page refresh).
  const activelyRunningId = runnerState.status === 'RUNNING' ? runnerState.campaignId : null
  const scheduledCamps    = campaigns.filter(c => c.status === 'SCHEDULED' || (c.status === 'RUNNING' && c.id === activelyRunningId))
  const interruptedCamps  = campaigns.filter(c => c.status === 'RUNNING' && c.id !== activelyRunningId)
  const pausedCamps       = campaigns.filter(c => c.status === 'PAUSED')
  const completedCamps    = campaigns.filter(c => !['SCHEDULED','RUNNING','PAUSED'].includes(c.status))

  return (
    <div>
      <PageHeader title="Campaign History" subtitle="All past and scheduled campaign runs">
        <Btn variant="secondary" size="sm" onClick={load}>↻ Refresh</Btn>
      </PageHeader>

      {loading ? (
        <div className="card p-16 text-center text-sm text-slate-400">Loading...</div>
      ) : campaigns.length === 0 ? (
        <div className="card p-16">
          <Empty icon={History} title="No campaigns yet" sub="Run your first campaign to see history here" />
        </div>
      ) : (
        <div className="space-y-6">

          {/* Scheduled / Running campaigns */}
          {scheduledCamps.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Calendar size={15} className="text-amber-500" />
                <h2 className="text-sm font-bold text-amber-700 uppercase tracking-wide">Scheduled / Running</h2>
                <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-semibold">{scheduledCamps.length}</span>
              </div>
              <div className="space-y-3">
                {scheduledCamps.map(c => (
                  <CampaignRow
                    key={c.id} c={c} isScheduled={true} isPaused={false}
                    expanded={expanded} detail={expanded === c.id ? detail : null} trackingData={trackingData}
                    onExpand={expand} onEdit={setEditingCamp} onCancel={cancelSchedule}
                    onDelete={deleteCampaign} onViewEmail={openEmailModal}
                    onResume={resumeCampaign} runnerState={runnerState}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Interrupted campaigns (crashed / page-refreshed mid-run) */}
          {interruptedCamps.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Zap size={15} className="text-purple-500" />
                <h2 className="text-sm font-bold text-purple-700 uppercase tracking-wide">Interrupted</h2>
                <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-semibold">{interruptedCamps.length}</span>
                <span className="text-[10px] text-purple-500 ml-1">— Stopped by a crash or page refresh · Resume to continue from last checkpoint</span>
              </div>
              <div className="space-y-3">
                {interruptedCamps.map(c => (
                  <CampaignRow
                    key={c.id} c={c} isScheduled={false} isPaused={false} isInterrupted={true}
                    expanded={expanded} detail={expanded === c.id ? detail : null} trackingData={trackingData}
                    onExpand={expand} onEdit={setEditingCamp} onCancel={cancelSchedule}
                    onDelete={deleteCampaign} onViewEmail={openEmailModal}
                    onResume={resumeCampaign} runnerState={runnerState}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Paused campaigns */}
          {pausedCamps.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Pause size={15} className="text-orange-500" />
                <h2 className="text-sm font-bold text-orange-700 uppercase tracking-wide">Paused</h2>
                <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full font-semibold">{pausedCamps.length}</span>
                <span className="text-[10px] text-orange-500 ml-1">— Cap-paused campaigns resume after 24 h · Manually paused resume immediately</span>
              </div>
              <div className="space-y-3">
                {pausedCamps.map(c => (
                  <CampaignRow
                    key={c.id} c={c} isScheduled={false} isPaused={true}
                    expanded={expanded} detail={expanded === c.id ? detail : null} trackingData={trackingData}
                    onExpand={expand} onEdit={setEditingCamp} onCancel={cancelSchedule}
                    onDelete={deleteCampaign} onViewEmail={openEmailModal}
                    onResume={resumeCampaign} runnerState={runnerState}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Completed campaigns */}
          {completedCamps.length > 0 && (
            <div>
              {(scheduledCamps.length > 0 || pausedCamps.length > 0) && (
                <div className="flex items-center gap-2 mb-3">
                  <History size={15} className="text-slate-400" />
                  <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wide">Completed</h2>
                </div>
              )}
              <div className="space-y-3">
                {completedCamps.map(c => (
                  <CampaignRow
                    key={c.id} c={c} isScheduled={false} isPaused={false}
                    expanded={expanded} detail={expanded === c.id ? detail : null} trackingData={trackingData}
                    onExpand={expand} onEdit={setEditingCamp} onCancel={cancelSchedule}
                    onDelete={deleteCampaign} onViewEmail={openEmailModal}
                    onResume={resumeCampaign} runnerState={runnerState}
                  />
                ))}
              </div>
            </div>
          )}

        </div>
      )}

      {/* Edit scheduled campaign modal */}
      {editingCamp && (
        <EditScheduledModal
          campaign={editingCamp}
          onClose={() => setEditingCamp(null)}
          onSaved={updated => {
            setCampaigns(prev => prev.map(x => x.id === updated.id ? { ...x, ...updated } : x))
            setEditingCamp(null)
          }}
        />
      )}

      {/* Email Detail Modal */}
      {viewingEmail && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
             onClick={() => setViewingEmail(null)}>
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[85vh] flex flex-col"
               onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
              <div>
                <h3 className="text-sm font-bold text-slate-900">{viewingEmail.lead_name}</h3>
                <p className="text-xs text-slate-500 font-mono">{viewingEmail.lead_email}</p>
              </div>
              <div className="flex items-center gap-4">
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

            <div className="flex border-b border-slate-200 px-5">
              {['body','events'].map(t => (
                <button key={t} onClick={() => setModalTab(t)}
                  className={`py-2.5 px-4 text-xs font-semibold border-b-2 transition-colors capitalize ${modalTab===t ? 'border-emerald-500 text-emerald-700' : 'border-transparent text-slate-400 hover:text-slate-600'}`}>
                  {t === 'body' ? '📧 Email Body' : `📋 Events${modalEvents.length > 0 ? ` (${modalEvents.length})` : ''}`}
                </button>
              ))}
            </div>

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
                        : <p className="text-sm text-slate-400 text-center py-6">Body not recorded for this send.</p>
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
                        {modalEvents.map((ev, i) => {
                          const clickUrl = ev.event_type === 'click' && ev.target_url && !ev.target_url.startsWith('campaign:') ? ev.target_url : null
                          return (
                            <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                              <td className="px-3 py-2">
                                <span className={`badge text-[10px] ${ev.event_type==='open' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}`}>
                                  {ev.event_type==='open' ? '👁 Opened' : '🖱 Clicked'}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-slate-600 font-mono whitespace-nowrap">{new Date(parseInt(ev.created_at)).toLocaleString('en-IN')}</td>
                              <td className="px-3 py-2 text-slate-500 font-mono">{ev.ip||'—'}</td>
                              <td className="px-3 py-2 text-slate-600">{parseBrowser(ev.user_agent)}</td>
                              <td className="px-3 py-2 text-slate-500 max-w-[160px]">
                                {clickUrl
                                  ? <a href={clickUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline truncate block">{clickUrl.replace(/^https?:\/\//,'').substring(0,40)}…</a>
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
