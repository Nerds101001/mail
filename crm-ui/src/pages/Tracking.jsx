import { useState } from 'react'
import { useCRM } from '../store'
import { fmtDate } from '../utils'
import { StatCard, Empty, PageHeader, Btn, toast } from '../components/ui'
import { Send, Eye, MousePointer, MessageSquare, RefreshCw } from 'lucide-react'

export default function Tracking() {
  const { leads, setLeads, pushToRedis, logActivity } = useCRM()
  const [syncing, setSyncing] = useState(false)
  const [info, setInfo] = useState('')

  const sent    = leads.filter(l => ['SENT','REPLIED','FOLLOW-UP'].includes(l.status))
  const totalOpens  = leads.reduce((s, l) => s + (l.opens || 0), 0)
  const totalClicks = leads.reduce((s, l) => s + (l.clicks || 0), 0)
  const replied = leads.filter(l => l.status === 'REPLIED').length

  async function syncTracking() {
    setSyncing(true)
    if (!sent.length) { setSyncing(false); return }
    try {
      const ids = sent.map(l => l.id).join(',')
      const res = await fetch(`/api/tracking-stats?ids=${ids}`)
      if (!res.ok) throw new Error('API unavailable')
      const stats = await res.json()
      let updated = 0
      const newLeads = leads.map(l => {
        if (!stats[l.id]) return l
        const so = stats[l.id].opens || 0, sc = stats[l.id].clicks || 0
        if (so !== l.opens || sc !== l.clicks) { updated++; return { ...l, opens: so, clicks: sc } }
        return l
      })
      if (updated > 0) { setLeads(newLeads); pushToRedis() }
      setInfo(`✓ Synced ${sent.length} leads — ${new Date().toLocaleTimeString()}`)
    } catch(e) { setInfo('⚠ Could not sync from server') }
    setSyncing(false)
  }

  function markReplied(id) {
    const lead = leads.find(l => l.id === id)
    setLeads(leads.map(l => l.id === id ? { ...l, status: 'REPLIED', pipelineStage: 'WON' } : l))
    pushToRedis()
    logActivity(`Marked replied: ${lead?.name}`)
    toast(`${lead?.name} marked as replied`, 'success')
  }

  return (
    <div>
      <PageHeader title="Mail Tracking" subtitle="Real-time open and click tracking">
        <Btn variant="secondary" size="sm" onClick={syncTracking} disabled={syncing}>
          <RefreshCw size={13} className={syncing ? 'animate-spin' : ''} /> Sync
        </Btn>
      </PageHeader>

      {info && <div className="mb-4 text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-4 py-2">{info}</div>}

      <div className="grid grid-cols-4 gap-4 mb-6">
        <StatCard label="Emails Sent"  value={sent.length}   icon={Send}          color="slate" />
        <StatCard label="Opens"        value={totalOpens}    sub={sent.length ? Math.round(totalOpens/sent.length*100)+'% open rate' : ''} icon={Eye} color="blue" />
        <StatCard label="Clicks"       value={totalClicks}   sub={sent.length ? Math.round(totalClicks/sent.length*100)+'% CTR' : ''}      icon={MousePointer} color="amber" />
        <StatCard label="Replies"      value={replied}       sub={sent.length ? Math.round(replied/sent.length*100)+'% reply rate' : ''}   icon={MessageSquare} color="emerald" />
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
              <tr key={l.id} className="table-row">
                <td className="px-4 py-3 font-semibold text-slate-900">{l.name}</td>
                <td className="px-4 py-3 text-slate-500 font-mono text-xs">{l.email}</td>
                <td className="px-4 py-3 text-slate-600">{l.company || '—'}</td>
                <td className="px-4 py-3">
                  <span className="badge text-[11px] bg-blue-100 text-blue-700">{l.pipelineStage || '—'}</span>
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
                  <Btn variant="secondary" size="sm" onClick={() => markReplied(l.id)}>✓ Replied</Btn>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
