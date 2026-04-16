import { useState } from 'react'
import { useCRM } from '../store'
import { fmtCurrency, fmtDate } from '../utils'
import { Modal, Btn, Input, Select, Textarea, Empty, PageHeader, toast } from '../components/ui'
import { Plus, Trash2, Search, Phone, FileText, ShoppingCart } from 'lucide-react'

const STATUS_COLORS = { OPEN:'bg-slate-100 text-slate-600', SENT:'bg-blue-100 text-blue-700', ACCEPTED:'bg-emerald-100 text-emerald-700', REJECTED:'bg-red-100 text-red-700', DONE:'bg-purple-100 text-purple-700' }
const TYPE_COLORS   = { DEMO:'bg-purple-100 text-purple-700', QUOTATION:'bg-amber-100 text-amber-700', ORDER:'bg-emerald-100 text-emerald-700' }
const TYPE_ICONS    = { DEMO: Phone, QUOTATION: FileText, ORDER: ShoppingCart }

export default function Deals() {
  const { deals, setDeals, pushToRedis, logActivity } = useCRM()
  const [search, setSearch]   = useState('')
  const [typeF, setTypeF]     = useState('')
  const [statusF, setStatusF] = useState('')
  const [open, setOpen]       = useState(false)
  const [dealType, setDealType] = useState('QUOTATION')
  const [form, setForm]       = useState({ clientName:'', company:'', amount:'', status:'OPEN', demoDate:'', demoTime:'', notes:'' })

  const filtered = deals.filter(d => {
    const s = search.toLowerCase()
    return (!s || [d.clientName||'',d.company||'',d.notes||''].join(' ').toLowerCase().includes(s))
      && (!typeF || d.type === typeF) && (!statusF || d.status === statusF)
  })

  function save(newDeals) { setDeals(newDeals); pushToRedis() }

  function openAdd(type) { setDealType(type); setForm({ clientName:'', company:'', amount:'', status:'OPEN', demoDate:'', demoTime:'', notes:'' }); setOpen(true) }

  function saveDeal() {
    if (!form.clientName) { toast('Contact name required', 'error'); return }
    const deal = { id:'deal_'+Date.now(), createdAt:new Date().toISOString(), type:dealType, ...form }
    save([...deals, deal])
    logActivity(`New ${dealType}: ${form.clientName} — ${fmtCurrency(form.amount)}`)
    toast(`${dealType} added`, 'success')
    setOpen(false)
  }

  function updateStatus(id, status) {
    save(deals.map(d => d.id === id ? { ...d, status } : d))
    toast(`Deal → ${status}`, 'success')
  }

  function deleteDeal(id) {
    if (!confirm('Delete this deal?')) return
    save(deals.filter(d => d.id !== id))
    toast('Deal deleted', 'info')
  }

  const total = filtered.reduce((s, d) => s + (parseFloat(d.amount) || 0), 0)

  return (
    <div>
      <PageHeader title="Deals & Quotations" subtitle={`${deals.length} deals · ${fmtCurrency(total)} pipeline`}>
        <Btn variant="secondary" size="sm" onClick={() => openAdd('DEMO')}><Phone size={13} /> Demo Call</Btn>
        <Btn variant="secondary" size="sm" onClick={() => openAdd('QUOTATION')}><FileText size={13} /> Quotation</Btn>
        <Btn variant="primary" onClick={() => openAdd('ORDER')}><ShoppingCart size={13} /> Order</Btn>
      </PageHeader>

      <div className="flex gap-3 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className="input pl-9" placeholder="Search name, notes..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="input w-36" value={typeF} onChange={e => setTypeF(e.target.value)}>
          <option value="">All Types</option><option>DEMO</option><option>QUOTATION</option><option>ORDER</option>
        </select>
        <select className="input w-36" value={statusF} onChange={e => setStatusF(e.target.value)}>
          <option value="">All Status</option><option>OPEN</option><option>SENT</option><option>ACCEPTED</option><option>REJECTED</option><option>DONE</option>
        </select>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              {['Type','Contact','Company','Amount','Status','Date','Notes','Actions'].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={8}><Empty icon={FileText} title="No deals yet" sub="Add a demo call, quotation or order" /></td></tr>
            ) : filtered.map(d => {
              const Icon = TYPE_ICONS[d.type] || FileText
              return (
                <tr key={d.id} className="table-row">
                  <td className="px-4 py-3">
                    <span className={`badge text-[11px] flex items-center gap-1 w-fit ${TYPE_COLORS[d.type]}`}>
                      <Icon size={11} />{d.type}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-semibold text-slate-900">{d.clientName || '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{d.company || '—'}</td>
                  <td className="px-4 py-3 font-bold text-emerald-600">{fmtCurrency(d.amount)}</td>
                  <td className="px-4 py-3">
                    <select className={`badge text-[11px] border-0 cursor-pointer ${STATUS_COLORS[d.status]}`} value={d.status} onChange={e => updateStatus(d.id, e.target.value)}>
                      <option>OPEN</option><option>SENT</option><option>ACCEPTED</option><option>REJECTED</option><option>DONE</option>
                    </select>
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-xs">{d.demoDate ? fmtDate(d.demoDate) + (d.demoTime ? ' '+d.demoTime : '') : fmtDate(d.createdAt)}</td>
                  <td className="px-4 py-3 text-slate-400 text-xs max-w-[160px] truncate">{d.notes || '—'}</td>
                  <td className="px-4 py-3">
                    <button className="p-1.5 rounded-lg hover:bg-red-50 text-red-400 transition-colors" onClick={() => deleteDeal(d.id)}><Trash2 size={13} /></button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <div className="px-4 py-3 border-t border-slate-100 bg-slate-50 text-xs text-slate-500">
          {filtered.length} deals · {fmtCurrency(total)} total
        </div>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={`Add ${dealType}`}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Input label="Contact Name *" value={form.clientName} onChange={e => setForm({...form,clientName:e.target.value})} placeholder="John Doe" />
            <Input label="Company" value={form.company} onChange={e => setForm({...form,company:e.target.value})} placeholder="Acme Corp" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Amount (₹)" type="number" value={form.amount} onChange={e => setForm({...form,amount:e.target.value})} placeholder="50000" />
            <Select label="Status" value={form.status} onChange={e => setForm({...form,status:e.target.value})}>
              <option>OPEN</option><option>SENT</option><option>ACCEPTED</option><option>REJECTED</option><option>DONE</option>
            </Select>
          </div>
          {dealType === 'DEMO' && (
            <div className="grid grid-cols-2 gap-3">
              <Input label="Demo Date" type="date" value={form.demoDate} onChange={e => setForm({...form,demoDate:e.target.value})} />
              <Input label="Demo Time" type="time" value={form.demoTime} onChange={e => setForm({...form,demoTime:e.target.value})} />
            </div>
          )}
          <Textarea label="Notes" value={form.notes} onChange={e => setForm({...form,notes:e.target.value})} placeholder="Details, requirements..." />
          <div className="flex justify-end gap-2 pt-2">
            <Btn variant="secondary" onClick={() => setOpen(false)}>Cancel</Btn>
            <Btn variant="primary" onClick={saveDeal}>Save {dealType}</Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}
