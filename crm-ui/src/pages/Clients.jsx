import { useState } from 'react'
import { useCRM } from '../store'
import { daysDiff, fmtCurrency, fmtDate, PAYMENT_COLORS } from '../utils'
import { Modal, Btn, Input, Select, Textarea, Empty, PageHeader, toast } from '../components/ui'
import { Plus, Pencil, Trash2, Search, AlertCircle, RotateCcw } from 'lucide-react'

const empty = { name:'', company:'', email:'', phone:'', software:'', amount:'', paymentStatus:'PENDING', renewalDate:'', notes:'' }

export default function Clients() {
  const { clients, setClients, leads, setLeads, pushToRedis, logActivity } = useCRM()
  const [search, setSearch]   = useState('')
  const [payF, setPayF]       = useState('')
  const [renF, setRenF]       = useState('')
  const [open, setOpen]       = useState(false)
  const [editing, setEditing] = useState(null) // index
  const [form, setForm]       = useState(empty)

  const filtered = clients.filter(c => {
    const s = search.toLowerCase()
    const match = !s || [c.name||'',c.company||'',c.software||''].join(' ').toLowerCase().includes(s)
    const matchPay = !payF || c.paymentStatus === payF
    let matchRen = true
    if (renF === 'soon') { const d = daysDiff(c.renewalDate); matchRen = d !== null && d >= 0 && d <= 30 }
    if (renF === 'overdue') { const d = daysDiff(c.renewalDate); matchRen = d !== null && d < 0 }
    return match && matchPay && matchRen
  })

  function save(newClients) { setClients(newClients); pushToRedis() }

  function openAdd() { setForm(empty); setEditing(null); setOpen(true) }
  function openEdit(i) { setForm({ ...clients[i], amount: clients[i].amount || '' }); setEditing(i); setOpen(true) }

  function saveClient() {
    if (!form.name || !form.company) { toast('Name and company required', 'error'); return }
    if (editing !== null) {
      const updated = [...clients]; updated[editing] = { ...clients[editing], ...form }
      save(updated); toast('Client updated', 'success')
      logActivity(`Updated client: ${form.name}`)
    } else {
      const client = { id:'client_'+Date.now(), createdAt:new Date().toISOString(), renewalStatus:'ACTIVE', ...form }
      save([...clients, client]); toast(`${form.name} added`, 'success')
      logActivity(`Added client: ${form.name} (${form.company})`)
    }
    setOpen(false)
  }

  function deleteClient(i) {
    if (!confirm('Delete this client?')) return
    const name = clients[i].name
    save(clients.filter((_, idx) => idx !== i))
    toast(`Deleted: ${name}`, 'info')
  }

  function updatePayment(i, status) {
    const updated = [...clients]; updated[i] = { ...updated[i], paymentStatus: status }
    save(updated); toast(`${clients[i].name} → ${status}`, 'success')
    logActivity(`Payment: ${clients[i].name} → ${status}`)
  }

  const totalRevenue = clients.reduce((s, c) => s + (parseFloat(c.amount) || 0), 0)

  return (
    <div>
      <PageHeader title="Client Management" subtitle={`${clients.length} clients · ${fmtCurrency(totalRevenue)} total`}>
        <Btn variant="primary" onClick={openAdd}><Plus size={14} /> Add Client</Btn>
      </PageHeader>

      <div className="flex gap-3 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className="input pl-9" placeholder="Search name, company, software..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="input w-36" value={payF} onChange={e => setPayF(e.target.value)}>
          <option value="">All Payments</option><option>PAID</option><option>PENDING</option><option>OVERDUE</option>
        </select>
        <select className="input w-40" value={renF} onChange={e => setRenF(e.target.value)}>
          <option value="">All Renewals</option><option value="soon">Due Soon (30d)</option><option value="overdue">Overdue</option>
        </select>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              {['Name','Company','Software','Amount','Payment','Renewal','Contact','Actions'].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={8}><Empty icon={AlertCircle} title="No clients found" sub="Add your first client" /></td></tr>
            ) : filtered.map((c, i) => {
              const renewDays = daysDiff(c.renewalDate)
              const renewLabel = renewDays === null ? '—' : renewDays < 0
                ? <span className="text-red-600 font-semibold">Expired {Math.abs(renewDays)}d ago</span>
                : renewDays <= 7 ? <span className="text-red-600 font-semibold">{renewDays}d left</span>
                : renewDays <= 30 ? <span className="text-amber-600 font-semibold">{renewDays}d left</span>
                : <span className="text-slate-500">{fmtDate(c.renewalDate)}</span>
              const payColor = PAYMENT_COLORS[c.paymentStatus] || 'bg-slate-100 text-slate-600'
              const idx = clients.indexOf(c)
              return (
                <tr key={c.id} className="table-row">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center text-xs font-bold text-blue-700">{(c.name||'?')[0]}</div>
                      <span className="font-semibold text-slate-900">{c.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{c.company}</td>
                  <td className="px-4 py-3 text-slate-600">{c.software || '—'}</td>
                  <td className="px-4 py-3 font-bold text-emerald-600">{fmtCurrency(c.amount)}</td>
                  <td className="px-4 py-3">
                    <select className={`badge text-[11px] border-0 cursor-pointer ${payColor}`} value={c.paymentStatus} onChange={e => updatePayment(idx, e.target.value)}>
                      <option>PAID</option><option>PENDING</option><option>OVERDUE</option>
                    </select>
                  </td>
                  <td className="px-4 py-3 text-sm">{renewLabel}</td>
                  <td className="px-4 py-3 text-slate-500 text-xs font-mono">{c.email || c.phone || '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      <button className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors" onClick={() => openEdit(idx)}><Pencil size={13} /></button>
                      <button className="p-1.5 rounded-lg hover:bg-red-50 text-red-400 transition-colors" onClick={() => deleteClient(idx)}><Trash2 size={13} /></button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <div className="px-4 py-3 border-t border-slate-100 bg-slate-50 text-xs text-slate-500">
          {filtered.length} of {clients.length} clients
        </div>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={editing !== null ? 'Edit Client' : 'Add Client'}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Input label="Full Name *" value={form.name} onChange={e => setForm({...form,name:e.target.value})} placeholder="John Doe" />
            <Input label="Company *" value={form.company} onChange={e => setForm({...form,company:e.target.value})} placeholder="Acme Corp" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Email" type="email" value={form.email} onChange={e => setForm({...form,email:e.target.value})} placeholder="john@acme.com" />
            <Input label="Phone" value={form.phone} onChange={e => setForm({...form,phone:e.target.value})} placeholder="+91 98765 43210" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Software / Product" value={form.software} onChange={e => setForm({...form,software:e.target.value})} placeholder="ERP Pro, CRM Basic..." />
            <Input label="Amount (₹)" type="number" value={form.amount} onChange={e => setForm({...form,amount:e.target.value})} placeholder="50000" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Select label="Payment Status" value={form.paymentStatus} onChange={e => setForm({...form,paymentStatus:e.target.value})}>
              <option>PAID</option><option>PENDING</option><option>OVERDUE</option>
            </Select>
            <Input label="Renewal Date" type="date" value={form.renewalDate} onChange={e => setForm({...form,renewalDate:e.target.value})} />
          </div>
          <Textarea label="Notes" value={form.notes} onChange={e => setForm({...form,notes:e.target.value})} placeholder="Any notes..." />
          <div className="flex justify-end gap-2 pt-2">
            <Btn variant="secondary" onClick={() => setOpen(false)}>Cancel</Btn>
            <Btn variant="primary" onClick={saveClient}>{editing !== null ? 'Update' : 'Save Client'}</Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}
