import { useState, useEffect } from 'react'
import { useCRM } from '../store'
import { PageHeader, Btn, Modal, Input, Textarea, Badge, Empty, toast } from '../components/ui'
import { Plus, FileText, Download, Send, Trash2, CheckCircle, Clock, XCircle, Printer } from 'lucide-react'

const STATUS_COLORS = {
  DRAFT:     'bg-slate-100 text-slate-600',
  SENT:      'bg-blue-100 text-blue-700',
  PAID:      'bg-emerald-100 text-emerald-700',
  OVERDUE:   'bg-red-100 text-red-700',
  CANCELLED: 'bg-gray-100 text-gray-500',
}
const STATUS_ICONS = { DRAFT: Clock, SENT: Send, PAID: CheckCircle, OVERDUE: XCircle, CANCELLED: XCircle }

function fmtCurrency(v) { return '₹' + (parseFloat(v)||0).toLocaleString('en-IN', { minimumFractionDigits: 2 }) }
function fmtDate(d) { return d ? new Date(d).toLocaleDateString('en-IN') : '—' }

const EMPTY_ITEM = { description: '', qty: 1, rate: 0, amount: 0 }

export default function Invoices() {
  const { clients, viewAs } = useCRM()
  const [invoices, setInvoices] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [open,     setOpen]     = useState(false)
  const [editInv,  setEditInv]  = useState(null)
  const [saving,   setSaving]   = useState(false)
  const [filter,   setFilter]   = useState('ALL')

  const authHeader = () => ({ Authorization: `Bearer ${localStorage.getItem('crm_token') || ''}` })
  const vaParam    = () => viewAs ? `&viewAs=${encodeURIComponent(viewAs)}` : ''

  const EMPTY_FORM = {
    client_id: '', client_name: '', client_email: '',
    items: [{ ...EMPTY_ITEM }],
    tax: 0, due_date: '', notes: '', status: 'DRAFT',
  }
  const [form, setForm] = useState(EMPTY_FORM)

  async function load() {
    setLoading(true)
    try {
      const r = await fetch(`/api/invoices${vaParam() ? '?' + vaParam().slice(1) : ''}`, { headers: authHeader() })
      const data = await r.json()
      setInvoices(Array.isArray(data) ? data : [])
    } catch { toast('Failed to load invoices', 'error') }
    setLoading(false)
  }

  useEffect(() => { load() }, [viewAs])

  function recalc(items, tax) {
    const subtotal = items.reduce((s, i) => s + (parseFloat(i.amount)||0), 0)
    const taxAmt   = subtotal * (parseFloat(tax)||0) / 100
    return { subtotal, tax: taxAmt, total: subtotal + taxAmt }
  }

  function updateItem(idx, field, value) {
    const items = form.items.map((it, i) => {
      if (i !== idx) return it
      const updated = { ...it, [field]: value }
      if (field === 'qty' || field === 'rate')
        updated.amount = (parseFloat(updated.qty)||0) * (parseFloat(updated.rate)||0)
      return updated
    })
    setForm(f => ({ ...f, items }))
  }

  function openNew() {
    setEditInv(null)
    setForm(EMPTY_FORM)
    setOpen(true)
  }

  function openEdit(inv) {
    setEditInv(inv)
    setForm({
      client_id:    inv.client_id    || '',
      client_name:  inv.client_name  || '',
      client_email: inv.client_email || '',
      items:        inv.items?.length ? inv.items : [{ ...EMPTY_ITEM }],
      tax:          inv.tax ? (parseFloat(inv.tax) / parseFloat(inv.subtotal||1) * 100).toFixed(0) : 0,
      due_date:     inv.due_date || '',
      notes:        inv.notes || '',
      status:       inv.status || 'DRAFT',
    })
    setOpen(true)
  }

  function pickClient(clientId) {
    const c = clients.find(c => c.id === clientId)
    if (c) setForm(f => ({ ...f, client_id: c.id, client_name: c.name||c.company||'', client_email: c.email||'' }))
    else   setForm(f => ({ ...f, client_id: clientId }))
  }

  async function save() {
    setSaving(true)
    try {
      const { subtotal, tax, total } = recalc(form.items, form.tax)
      const payload = { ...form, subtotal, tax, total }
      const url    = editInv ? `/api/invoices?id=${editInv.id}` : '/api/invoices'
      const method = editInv ? 'PUT' : 'POST'
      const r = await fetch(url, { method, headers: { ...authHeader(), 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const d = await r.json()
      if (!d.ok && !d.invoice) { toast(d.error || 'Save failed', 'error'); return }
      toast(editInv ? 'Invoice updated' : 'Invoice created', 'success')
      setOpen(false); load()
    } catch { toast('Save failed', 'error') }
    setSaving(false)
  }

  async function deleteInv(id) {
    if (!confirm('Delete this invoice?')) return
    await fetch(`/api/invoices?id=${id}`, { method: 'DELETE', headers: authHeader() })
    toast('Deleted', 'success'); load()
  }

  async function updateStatus(id, status) {
    await fetch(`/api/invoices?id=${id}`, { method: 'PUT', headers: { ...authHeader(), 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) })
    load()
  }

  function printInvoice(inv) {
    const items = (inv.items||[]).map(i =>
      `<tr><td style="padding:8px 12px;border-bottom:1px solid #f1f5f9">${i.description||''}</td>
       <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;text-align:center">${i.qty||1}</td>
       <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;text-align:right">₹${parseFloat(i.rate||0).toLocaleString('en-IN')}</td>
       <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;text-align:right">₹${parseFloat(i.amount||0).toLocaleString('en-IN')}</td></tr>`
    ).join('')
    const html = `<!DOCTYPE html><html><head><title>Invoice ${inv.number}</title>
    <style>body{font-family:Arial,sans-serif;margin:40px;color:#1e293b}@media print{body{margin:20px}}</style></head><body>
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:32px">
      <div><h1 style="color:#6366f1;margin:0">INVOICE</h1><p style="color:#64748b;margin:4px 0 0">${inv.number}</p></div>
      <div style="text-align:right"><h2 style="margin:0;color:#1e293b">EnginErds Tech Solution</h2>
        <p style="color:#64748b;margin:4px 0 0">enginerds.in</p></div>
    </div>
    <div style="display:flex;justify-content:space-between;margin-bottom:32px">
      <div><p style="font-weight:bold;margin:0 0 4px">Bill To</p>
        <p style="margin:0">${inv.client_name||'—'}</p>
        <p style="margin:0;color:#64748b">${inv.client_email||''}</p></div>
      <div style="text-align:right">
        <p style="margin:0"><strong>Due Date:</strong> ${fmtDate(inv.due_date)}</p>
        <p style="margin:0"><strong>Status:</strong> ${inv.status}</p></div>
    </div>
    <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
      <thead><tr style="background:#f8fafc"><th style="padding:10px 12px;text-align:left">Description</th>
        <th style="padding:10px 12px;text-align:center">Qty</th>
        <th style="padding:10px 12px;text-align:right">Rate</th>
        <th style="padding:10px 12px;text-align:right">Amount</th></tr></thead>
      <tbody>${items}</tbody></table>
    <div style="display:flex;justify-content:flex-end"><div style="width:240px">
      <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #e2e8f0">
        <span>Subtotal</span><span>${fmtCurrency(inv.subtotal)}</span></div>
      <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #e2e8f0">
        <span>Tax</span><span>${fmtCurrency(inv.tax)}</span></div>
      <div style="display:flex;justify-content:space-between;padding:8px 0;font-weight:bold;font-size:1.1em">
        <span>Total</span><span style="color:#6366f1">${fmtCurrency(inv.total)}</span></div>
    </div></div>
    ${inv.notes ? `<p style="margin-top:32px;color:#64748b;font-size:14px"><strong>Notes:</strong> ${inv.notes}</p>` : ''}
    </body></html>`
    const w = window.open('', '_blank')
    w.document.write(html); w.document.close(); w.focus(); w.print()
  }

  const filtered = filter === 'ALL' ? invoices : invoices.filter(i => i.status === filter)
  const totalPaid    = invoices.filter(i=>i.status==='PAID').reduce((s,i)=>s+parseFloat(i.total||0),0)
  const totalPending = invoices.filter(i=>i.status==='SENT').reduce((s,i)=>s+parseFloat(i.total||0),0)
  const totalDraft   = invoices.filter(i=>i.status==='DRAFT').reduce((s,i)=>s+parseFloat(i.total||0),0)
  const { subtotal: formSubtotal, tax: formTax, total: formTotal } = recalc(form.items, form.tax)

  return (
    <div className="space-y-6">
      <PageHeader title="Invoices" subtitle={`${invoices.length} total · ${fmtCurrency(totalPaid)} collected`}>
        <Btn variant="primary" onClick={openNew}><Plus size={14}/> New Invoice</Btn>
      </PageHeader>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
        {[
          { label:'Paid',    value: totalPaid,    color:'emerald', icon:'✅' },
          { label:'Pending', value: totalPending, color:'blue',    icon:'📤' },
          { label:'Draft',   value: totalDraft,   color:'slate',   icon:'📝' },
        ].map(s => (
          <div key={s.label} className="card p-4 flex items-center gap-4">
            <div className="text-2xl">{s.icon}</div>
            <div>
              <p className="text-xs text-slate-500 font-medium">{s.label}</p>
              <p className="text-lg font-bold text-slate-900">{fmtCurrency(s.value)}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2">
        {['ALL','DRAFT','SENT','PAID','OVERDUE'].map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${filter===f ? 'bg-indigo-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
            {f}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="py-20 text-center text-slate-400">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="py-16"><Empty icon={FileText} title="No invoices" sub="Create your first invoice to get started" /></div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[500px]">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>{['#','Client','Amount','Due Date','Status','Actions'].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-500">{h}</th>
              ))}</tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filtered.map(inv => {
                const SI = STATUS_ICONS[inv.status] || Clock
                return (
                  <tr key={inv.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs font-bold text-indigo-600">{inv.number}</td>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-slate-900 text-sm">{inv.client_name||'—'}</p>
                      <p className="text-xs text-slate-400">{inv.client_email||''}</p>
                    </td>
                    <td className="px-4 py-3 font-bold text-slate-900">{fmtCurrency(inv.total)}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{fmtDate(inv.due_date)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_COLORS[inv.status]||STATUS_COLORS.DRAFT}`}>
                        <SI size={10}/>{inv.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button onClick={() => openEdit(inv)} className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors" title="Edit"><FileText size={13}/></button>
                        <button onClick={() => printInvoice(inv)} className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors" title="Print / PDF"><Printer size={13}/></button>
                        {inv.status === 'DRAFT' && <button onClick={() => updateStatus(inv.id,'SENT')} className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 transition-colors" title="Mark Sent"><Send size={13}/></button>}
                        {inv.status === 'SENT'  && <button onClick={() => updateStatus(inv.id,'PAID')} className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 transition-colors" title="Mark Paid"><CheckCircle size={13}/></button>}
                        <button onClick={() => deleteInv(inv.id)} className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors" title="Delete"><Trash2 size={13}/></button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          </div>
        )}
      </div>

      {/* Create / Edit modal */}
      <Modal open={open} onClose={() => setOpen(false)} title={editInv ? `Edit ${editInv.number}` : 'New Invoice'} width="max-w-3xl">
        <div className="space-y-4">
          {/* Client */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Client</label>
              <select className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                value={form.client_id} onChange={e => pickClient(e.target.value)}>
                <option value="">— Select client —</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name||c.company||c.email}</option>)}
              </select>
            </div>
            <Input label="Client Email" value={form.client_email} onChange={e => setForm(f=>({...f,client_email:e.target.value}))} placeholder="client@example.com"/>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Client Name" value={form.client_name} onChange={e => setForm(f=>({...f,client_name:e.target.value}))} placeholder="Full name / Company"/>
            <Input label="Due Date" type="date" value={form.due_date} onChange={e => setForm(f=>({...f,due_date:e.target.value}))}/>
          </div>

          {/* Line items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-slate-600">Line Items</label>
              <button onClick={() => setForm(f=>({...f,items:[...f.items,{...EMPTY_ITEM}]}))}
                className="text-xs text-indigo-600 font-semibold hover:underline flex items-center gap-1"><Plus size={11}/>Add item</button>
            </div>
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50"><tr>
                  <th className="px-3 py-2 text-left text-xs text-slate-500 font-semibold">Description</th>
                  <th className="px-3 py-2 text-xs text-slate-500 font-semibold w-16">Qty</th>
                  <th className="px-3 py-2 text-xs text-slate-500 font-semibold w-24">Rate (₹)</th>
                  <th className="px-3 py-2 text-xs text-slate-500 font-semibold w-24">Amount</th>
                  <th className="w-8"/>
                </tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {form.items.map((item, idx) => (
                    <tr key={idx}>
                      <td className="px-2 py-1"><input className="w-full border-0 outline-none text-sm px-1 py-0.5 rounded focus:bg-slate-50" value={item.description} onChange={e => updateItem(idx,'description',e.target.value)} placeholder="Service / product description"/></td>
                      <td className="px-2 py-1"><input type="number" className="w-full border-0 outline-none text-sm text-center px-1 py-0.5 rounded focus:bg-slate-50" value={item.qty} onChange={e => updateItem(idx,'qty',e.target.value)} min="1"/></td>
                      <td className="px-2 py-1"><input type="number" className="w-full border-0 outline-none text-sm text-right px-1 py-0.5 rounded focus:bg-slate-50" value={item.rate} onChange={e => updateItem(idx,'rate',e.target.value)} min="0"/></td>
                      <td className="px-3 py-1 text-right text-slate-700 font-medium text-sm">{fmtCurrency(item.amount)}</td>
                      <td className="px-1"><button onClick={() => setForm(f=>({...f,items:f.items.filter((_,i)=>i!==idx)}))} className="text-slate-300 hover:text-red-400 transition-colors"><XCircle size={13}/></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Totals + Tax */}
          <div className="flex justify-between items-start gap-4">
            <Textarea label="Notes" value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} rows={2} placeholder="Payment terms, bank details, etc."/>
            <div className="w-52 flex-shrink-0 space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">Subtotal</span><span className="font-medium">{fmtCurrency(formSubtotal)}</span></div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-500">Tax %</span>
                <input type="number" value={form.tax} onChange={e=>setForm(f=>({...f,tax:e.target.value}))} className="w-16 text-right border border-slate-200 rounded px-2 py-0.5 text-sm focus:outline-none" min="0" max="100"/>
              </div>
              <div className="flex justify-between text-slate-500"><span>Tax Amount</span><span>{fmtCurrency(formTax)}</span></div>
              <div className="flex justify-between font-bold text-base pt-1 border-t border-slate-200"><span>Total</span><span className="text-indigo-600">{fmtCurrency(formTotal)}</span></div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Status</label>
              <select className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none" value={form.status} onChange={e=>setForm(f=>({...f,status:e.target.value}))}>
                {['DRAFT','SENT','PAID','OVERDUE','CANCELLED'].map(s=><option key={s}>{s}</option>)}
              </select>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
            <Btn variant="secondary" onClick={() => setOpen(false)}>Cancel</Btn>
            <Btn variant="primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : editInv ? 'Update Invoice' : 'Create Invoice'}</Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}
