import { useCRM } from '../store'
import { PageHeader, Empty, Btn, toast } from '../components/ui'
import { fmtDate } from '../utils'
import { UserX, Download } from 'lucide-react'

export default function Unsubscribes() {
  const { leads, setLeads, saveNow } = useCRM()

  const unsubscribed = leads.filter(l =>
    l.status === 'UNSUBSCRIBED' || l.pipelineStage === 'UNSUBSCRIBED'
  )

  async function resubscribe(id) {
    if (!confirm('Re-subscribe this contact? They will be able to receive emails again.')) return
    const updated = leads.map(l => l.id === id ? { ...l, status: 'VALID', pipelineStage: 'COLD' } : l)
    setLeads(updated)
    await saveNow()
    toast('Contact re-subscribed ✓', 'success')
  }

  function exportList() {
    const h = ['Name', 'Email', 'Company', 'Unsubscribed Date']
    const rows = unsubscribed.map(l => [l.name, l.email, l.company || '', l.lastSent || l.createdAt || ''].map(v => `"${v}"`).join(','))
    const blob = new Blob([[h.join(','), ...rows].join('\n')], { type: 'text/csv' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'unsubscribed.csv'; a.click()
    toast('Exported unsubscribe list', 'success')
  }

  return (
    <div>
      <PageHeader title="Unsubscribe List" subtitle={`${unsubscribed.length} contacts opted out`}>
        <Btn variant="secondary" onClick={exportList}><Download size={14} /> Export CSV</Btn>
      </PageHeader>

      {unsubscribed.length === 0 ? (
        <div className="card p-16">
          <Empty icon={UserX} title="No unsubscribes yet" sub="Contacts who click unsubscribe will appear here" />
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="px-5 py-3 bg-amber-50 border-b border-amber-200 text-sm text-amber-700 font-medium">
            ⚠ These contacts have opted out. They will be automatically skipped in all campaigns.
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                {['Name', 'Email', 'Company', 'Last Sent', 'Notes', 'Actions'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {unsubscribed.map(l => (
                <tr key={l.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3 font-semibold text-slate-900">{l.name}</td>
                  <td className="px-4 py-3 text-slate-500 font-mono text-xs">{l.email}</td>
                  <td className="px-4 py-3 text-slate-600">{l.company || '—'}</td>
                  <td className="px-4 py-3 text-slate-400 text-xs">{fmtDate(l.lastSent)}</td>
                  <td className="px-4 py-3 text-slate-400 text-xs max-w-[200px] truncate">{l.notes || '—'}</td>
                  <td className="px-4 py-3">
                    <Btn variant="ghost" size="sm" onClick={() => resubscribe(l.id)}>↩ Re-subscribe</Btn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-4 py-3 border-t border-slate-100 bg-slate-50 text-xs text-slate-500">
            {unsubscribed.length} unsubscribed contacts
          </div>
        </div>
      )}
    </div>
  )
}
