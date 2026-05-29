import { useCRM } from '../store'
import { PageHeader, Empty, Btn, toast } from '../components/ui'
import { fmtDate } from '../utils'
import { ThumbsUp, ThumbsDown, Download, RefreshCw } from 'lucide-react'
import { useState, useEffect } from 'react'

export default function Interests() {
  const { leads, setLeads, saveLeads } = useCRM()
  const [tab, setTab]               = useState('not-interested')
  const [interested, setInterested] = useState([])
  const [notInterested, setNotInterested] = useState([])
  const [loading, setLoading]       = useState(true)
  const authHeader = () => ({ Authorization: `Bearer ${localStorage.getItem('crm_token') || ''}` })

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    await Promise.all([loadInterested(), loadNotInterested()])
    setLoading(false)
  }

  async function loadInterested() {
    try {
      const res = await fetch('/api/ops?type=interested-list', { headers: authHeader() })
      if (res.ok) {
        const data = await res.json()
        setInterested(data.interested || [])
      }
    } catch {}
  }

  async function loadNotInterested() {
    try {
      const res = await fetch('/api/ops?type=unsubscribed-list', { headers: authHeader() })
      if (res.ok) {
        const data = await res.json()
        setNotInterested(data.unsubscribed || [])
      } else {
        setNotInterested(leads.filter(l => l.status === 'UNSUBSCRIBED' || l.pipelineStage === 'UNSUBSCRIBED'))
      }
    } catch {
      setNotInterested(leads.filter(l => l.status === 'UNSUBSCRIBED' || l.pipelineStage === 'UNSUBSCRIBED'))
    }
  }

  async function resubscribe(lead) {
    if (!confirm('Re-subscribe this contact? They will be able to receive emails again.')) return
    try {
      await fetch('/api/ops?type=resubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: lead.email }),
      })
      const updated = leads.map(l => l.id === lead.id ? { ...l, status: 'VALID', pipelineStage: 'COLD' } : l)
      setLeads(updated)
      await saveLeads(updated)
      setNotInterested(prev => prev.filter(l => l.id !== lead.id))
      toast(`${lead.name} re-subscribed ✓`, 'success')
    } catch (e) {
      toast('Failed to re-subscribe: ' + e.message, 'error')
    }
  }

  function exportCurrent() {
    const isInterested = tab === 'interested'
    const list = isInterested ? interested : notInterested
    const h = isInterested
      ? ['Name', 'Email', 'Company', 'Last Sent']
      : ['Name', 'Email', 'Company', 'Unsubscribed Date']
    const rows = list.map(l => [l.name, l.email, l.company || '', l.lastSent || ''].map(v => `"${v}"`).join(','))
    const blob = new Blob([[h.join(','), ...rows].join('\n')], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${tab}.csv`
    a.click()
    toast(`Exported ${list.length} contacts`, 'success')
  }

  return (
    <div>
      <PageHeader title="Interests" subtitle={`${interested.length} interested · ${notInterested.length} not interested`}>
        <div className="flex gap-2">
          <Btn variant="secondary" onClick={loadData} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </Btn>
          <Btn variant="secondary" onClick={exportCurrent} disabled={loading}>
            <Download size={14} /> Export CSV
          </Btn>
        </div>
      </PageHeader>

      {/* Tabs */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setTab('interested')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
            tab === 'interested'
              ? 'bg-emerald-500 text-white shadow'
              : 'bg-white text-slate-600 border border-slate-200 hover:bg-emerald-50'
          }`}
        >
          <ThumbsUp size={14} />
          Interested
          <span className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${tab === 'interested' ? 'bg-emerald-400 text-white' : 'bg-slate-100 text-slate-500'}`}>
            {interested.length}
          </span>
        </button>
        <button
          onClick={() => setTab('not-interested')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
            tab === 'not-interested'
              ? 'bg-red-500 text-white shadow'
              : 'bg-white text-slate-600 border border-slate-200 hover:bg-red-50'
          }`}
        >
          <ThumbsDown size={14} />
          Not Interested
          <span className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${tab === 'not-interested' ? 'bg-red-400 text-white' : 'bg-slate-100 text-slate-500'}`}>
            {notInterested.length}
          </span>
        </button>
      </div>

      {loading ? (
        <div className="card p-16 text-center text-slate-400">
          <RefreshCw size={24} className="animate-spin mx-auto mb-3" />
          Loading...
        </div>
      ) : tab === 'interested' ? (
        /* ── Interested Tab ── */
        interested.length === 0 ? (
          <div className="card p-16">
            <Empty icon={ThumbsUp} title="No interested leads yet"
              sub="Leads who click '✅ Yes, I'm Interested' in your emails will appear here" />
          </div>
        ) : (
          <div className="card overflow-hidden">
            <div className="px-5 py-3 bg-emerald-50 border-b border-emerald-200 text-sm text-emerald-700 font-medium">
              🎉 These leads clicked Interested — they have been moved to the <strong>DEMO</strong> pipeline stage.
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[500px]">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    {['Name', 'Email', 'Company', 'Responded'].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {interested.map(l => (
                    <tr key={l.id + l.email} className="border-b border-slate-100 hover:bg-emerald-50">
                      <td className="px-4 py-3 font-semibold text-slate-900">{l.name || '—'}</td>
                      <td className="px-4 py-3 text-slate-500 font-mono text-xs">{l.email}</td>
                      <td className="px-4 py-3 text-slate-600">{l.company || '—'}</td>
                      <td className="px-4 py-3 text-slate-400 text-xs">{fmtDate(l.lastSent)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-3 border-t border-slate-100 bg-slate-50 text-xs text-slate-500">
              {interested.length} interested contacts — moved to DEMO stage
            </div>
          </div>
        )
      ) : (
        /* ── Not Interested Tab ── */
        notInterested.length === 0 ? (
          <div className="card p-16">
            <Empty icon={ThumbsDown} title="No unsubscribed contacts"
              sub="Contacts who click 'Not Interested' or unsubscribe will appear here" />
          </div>
        ) : (
          <div className="card overflow-hidden">
            <div className="px-5 py-3 bg-amber-50 border-b border-amber-200 text-sm text-amber-700 font-medium">
              ⚠ These contacts have opted out. They will be automatically skipped in all campaigns.
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[550px]">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    {['Name', 'Email', 'Company', 'Last Sent', 'Actions'].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {notInterested.map(l => (
                    <tr key={l.id + l.email} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-4 py-3 font-semibold text-slate-900">{l.name}</td>
                      <td className="px-4 py-3 text-slate-500 font-mono text-xs">{l.email}</td>
                      <td className="px-4 py-3 text-slate-600">{l.company || '—'}</td>
                      <td className="px-4 py-3 text-slate-400 text-xs">{fmtDate(l.lastSent)}</td>
                      <td className="px-4 py-3">
                        <Btn variant="ghost" size="sm" onClick={() => resubscribe(l)}>↩ Re-subscribe</Btn>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-3 border-t border-slate-100 bg-slate-50 text-xs text-slate-500">
              {notInterested.length} unsubscribed contacts
            </div>
          </div>
        )
      )}
    </div>
  )
}
