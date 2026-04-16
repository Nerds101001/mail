import { useState } from 'react'
import { useCRM } from '../store'
import { enrichLead, isValidEmail, PIPELINE_STAGES, STAGE_COLORS, STATUS_COLORS, fmtDate } from '../utils'
import { Modal, Btn, Input, Select, Textarea, Badge, Empty, PageHeader, toast } from '../components/ui'
import { Plus, Upload, CheckCircle, Zap, Trash2, UserCheck, Search, Filter, Flame } from 'lucide-react'

export default function Leads() {
  const { leads, setLeads, profiles, settings, logActivity, pushToRedis } = useCRM()
  const [search, setSearch]   = useState('')
  const [stageF, setStageF]   = useState('')
  const [statusF, setStatusF] = useState('')
  const [priF, setPriF]       = useState('')
  const [selected, setSelected] = useState(new Set())
  const [addOpen, setAddOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [emailOpen, setEmailOpen] = useState(false)
  const [emailLead, setEmailLead] = useState(null)
  const [form, setForm] = useState({ name:'', email:'', company:'', phone:'', role:'GENERAL', category:'General', tags:'', notes:'', pipelineStage:'COLD' })
  const [csvText, setCsvText] = useState('')
  const [emailBody, setEmailBody] = useState('')
  const [emailSubject, setEmailSubject] = useState('')
  const [genLoading, setGenLoading] = useState(false)
  const [sendLoading, setSendLoading] = useState(false)

  const filtered = leads.filter(l => {
    const s = search.toLowerCase()
    return (!s || [l.name||'',l.email||'',l.company||''].join(' ').toLowerCase().includes(s))
      && (!stageF  || l.pipelineStage === stageF)
      && (!statusF || l.status === statusF)
      && (!priF    || l.priority === priF)
  })

  function save(newLeads) { setLeads(newLeads); pushToRedis() }

  function addLead() {
    if (!form.name || !form.email) { toast('Name and email required', 'error'); return }
    if (!isValidEmail(form.email)) { toast('Invalid email', 'error'); return }
    if (leads.find(l => l.email.toLowerCase() === form.email.toLowerCase())) { toast('Email already exists', 'error'); return }
    const l = enrichLead({ id:'lead_'+Date.now(), ...form, email:form.email.toLowerCase(), tags:form.tags.split(',').map(t=>t.trim()).filter(Boolean), opens:0, clicks:0, score:40, lastSent:'', domain:'', priority:'LOW', createdAt:new Date().toISOString() })
    save([...leads, l])
    logActivity(`Added lead: ${form.name} <${form.email}>`)
    toast(`${form.name} added`, 'success')
    setAddOpen(false)
    setForm({ name:'', email:'', company:'', phone:'', role:'GENERAL', category:'General', tags:'', notes:'', pipelineStage:'COLD' })
  }

  function deleteLead(id) {
    if (!confirm('Delete this lead?')) return
    save(leads.filter(l => l.id !== id))
    toast('Lead deleted', 'info')
  }

  function bulkDelete() {
    if (!selected.size) { toast('Select leads first', 'info'); return }
    if (!confirm(`Delete ${selected.size} leads?`)) return
    save(leads.filter(l => !selected.has(l.id)))
    setSelected(new Set())
    toast(`Deleted ${selected.size} leads`, 'info')
  }

  function changeStage(id, stage) {
    const newLeads = leads.map(l => l.id === id ? { ...l, pipelineStage: stage } : l)
    save(newLeads)
    toast(`Stage updated → ${stage}`, 'success')
  }

  function importCSV() {
    const lines = csvText.trim().split('\n').map(l => l.trim()).filter(Boolean)
    if (lines.length < 2) { toast('Need header + at least 1 row', 'error'); return }
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase())
    const ni = headers.indexOf('name'), ei = headers.indexOf('email')
    if (ei < 0) { toast('CSV must have Email column', 'error'); return }
    let added = 0
    const newLeads = [...leads]
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map(c => c.trim().replace(/^"|"$/g, ''))
      const email = cols[ei] || ''
      if (!email || !isValidEmail(email)) continue
      if (newLeads.find(l => l.email.toLowerCase() === email.toLowerCase())) continue
      const name = ni >= 0 ? (cols[ni] || email.split('@')[0]) : email.split('@')[0]
      newLeads.push(enrichLead({ id:'lead_'+(Date.now()+i), name, email:email.toLowerCase(), company:'', phone:'', role:'', category:'General', tags:[], status:'VALID', pipelineStage:'COLD', stage:'', opens:0, clicks:0, score:40, lastSent:'', domain:'', priority:'LOW', createdAt:new Date().toISOString() }))
      added++
    }
    save(newLeads)
    logActivity(`CSV import: ${added} leads`)
    toast(`Imported ${added} leads`, 'success')
    setImportOpen(false); setCsvText('')
  }

  async function generateEmail() {
    if (!settings.openaiKey) { toast('Set NVIDIA API key in Settings', 'error'); return }
    setGenLoading(true)
    try {
      const res = await fetch('/api/generate-ai', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ name:emailLead.name, company:emailLead.company||'their company', role:emailLead.role||'', category:emailLead.category||'', apiKey:settings.openaiKey }) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setEmailSubject(data.subject); setEmailBody(data.body)
    } catch(e) { toast('AI failed: '+e.message, 'error') }
    setGenLoading(false)
  }

  async function sendEmail() {
    const activeProfiles = profiles.filter(p => p.active)
    if (!activeProfiles.length) { toast('Add a sender profile in Settings', 'error'); return }
    const profile = activeProfiles[0]
    const body = emailBody || `Hi ${emailLead.name},\n\nI came across ${emailLead.company||'your company'} and was impressed by what you're building. At Enginerds Tech Solution, we specialize in ERP & SaaS solutions.\n\nWould you be open to a quick 15-minute call?\n\nBest,\nPawan Kumar\nEnginerds Tech Solution`
    const subject = emailSubject || `Quick idea for ${emailLead.company||'your company'}`
    setSendLoading(true)
    try {
      const endpoint = profile.type === 'gmail' ? '/api/send-email' : '/api/send-smtp'
      const payload = { leadId:emailLead.id, to:emailLead.email, subject, body, senderName:'Pawan Kumar - Enginerds Tech Solution', replyTo:'contact@enginerds.in' }
      if (profile.type === 'smtp') payload.smtpConfig = profile
      if (profile.type === 'gmail') payload.gmailUser = profile.user
      const res = await fetch(endpoint, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      if (data.skipped) { toast('Skipped — unsubscribed', 'info'); setEmailOpen(false); return }
      const newLeads = leads.map(l => l.id === emailLead.id ? { ...l, status:'SENT', stage:'1', lastSent:new Date().toISOString(), pipelineStage: ['CONTACTED','OPENED','HOT','DEMO','QUOTED','WON'].includes(l.pipelineStage) ? l.pipelineStage : 'CONTACTED' } : l)
      save(newLeads)
      logActivity(`Sent email to: ${emailLead.name}`)
      toast('Email sent ✓', 'success')
      setEmailOpen(false)
    } catch(e) { toast('Send failed: '+e.message, 'error') }
    setSendLoading(false)
  }

  const toggleSelect = (id) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  const toggleAll = () => setSelected(selected.size === filtered.length ? new Set() : new Set(filtered.map(l => l.id)))

  return (
    <div>
      <PageHeader title="Lead Management" subtitle={`${leads.length} total leads`}>
        <Btn variant="secondary" size="sm" onClick={() => setImportOpen(true)}><Upload size={14} /> Import CSV</Btn>
        <Btn variant="secondary" size="sm" onClick={() => { const newLeads = leads.map(enrichLead); save(newLeads); toast('Enriched', 'success') }}><Zap size={14} /> Enrich</Btn>
        <Btn variant="primary" onClick={() => setAddOpen(true)}><Plus size={14} /> Add Lead</Btn>
      </PageHeader>

      {/* Filters */}
      <div className="flex gap-3 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className="input pl-9" placeholder="Search name, email, company..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="input w-36" value={stageF} onChange={e => setStageF(e.target.value)}>
          <option value="">All Stages</option>
          {PIPELINE_STAGES.map(s => <option key={s}>{s}</option>)}
        </select>
        <select className="input w-36" value={statusF} onChange={e => setStatusF(e.target.value)}>
          <option value="">All Status</option>
          {['VALID','SENT','REPLIED','FOLLOW-UP','INVALID','DUPLICATE','PERSONAL','ROLE-BASED'].map(s => <option key={s}>{s}</option>)}
        </select>
        <select className="input w-32" value={priF} onChange={e => setPriF(e.target.value)}>
          <option value="">All Priority</option>
          <option>HIGH</option><option>MEDIUM</option><option>LOW</option>
        </select>
        {selected.size > 0 && (
          <Btn variant="danger" size="sm" onClick={bulkDelete}><Trash2 size={13} /> Delete {selected.size}</Btn>
        )}
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="px-4 py-3 w-10"><input type="checkbox" className="rounded" checked={selected.size === filtered.length && filtered.length > 0} onChange={toggleAll} /></th>
              <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wide">Name</th>
              <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wide">Email</th>
              <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wide">Company</th>
              <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wide">Stage</th>
              <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wide">Status</th>
              <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wide">Score</th>
              <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wide">Opens</th>
              <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wide">Last Sent</th>
              <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wide">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={10}><Empty icon={Users} title="No leads found" sub="Try adjusting your filters" /></td></tr>
            ) : filtered.map(l => {
              const sc = STAGE_COLORS[l.pipelineStage] || STAGE_COLORS.COLD
              const stc = STATUS_COLORS[l.status] || 'bg-slate-100 text-slate-600'
              const isHot = (l.opens >= 2 || l.clicks >= 1) && !['WON','LOST','UNSUBSCRIBED'].includes(l.pipelineStage)
              return (
                <tr key={l.id} className="table-row">
                  <td className="px-4 py-3"><input type="checkbox" className="rounded" checked={selected.has(l.id)} onChange={() => toggleSelect(l.id)} /></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-emerald-100 flex items-center justify-center text-xs font-bold text-emerald-700 flex-shrink-0">
                        {(l.name||'?')[0].toUpperCase()}
                      </div>
                      <span className="font-semibold text-slate-900">{l.name}</span>
                      {isHot && <Flame size={13} className="text-red-500" />}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-500 font-mono text-xs">{l.email}</td>
                  <td className="px-4 py-3 text-slate-600">{l.company || '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`badge text-[11px] ${sc.bg} ${sc.text}`}>{l.pipelineStage || 'COLD'}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`badge text-[11px] ${stc}`}>{l.status || '—'}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-bold text-emerald-600">{l.score || 0}</span>
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-xs">{l.opens||0}👁 {l.clicks||0}🖱</td>
                  <td className="px-4 py-3 text-slate-400 text-xs">{fmtDate(l.lastSent)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button className="p-1.5 rounded-lg hover:bg-blue-50 text-blue-500 transition-colors" title="Send Email" onClick={() => { setEmailLead(l); setEmailBody(''); setEmailSubject(''); setEmailOpen(true) }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                      </button>
                      <select className="text-xs border border-slate-200 rounded-lg px-1.5 py-1 bg-white text-slate-600 hover:border-slate-300 transition-colors" value="" onChange={e => { if(e.target.value) changeStage(l.id, e.target.value) }}>
                        <option value="">Stage</option>
                        {PIPELINE_STAGES.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                      <button className="p-1.5 rounded-lg hover:bg-red-50 text-red-400 transition-colors" onClick={() => deleteLead(l.id)}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <div className="px-4 py-3 border-t border-slate-100 bg-slate-50 text-xs text-slate-500">
          Showing {filtered.length} of {leads.length} leads
        </div>
      </div>

      {/* Add Lead Modal */}
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add New Lead">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Input label="Full Name *" value={form.name} onChange={e => setForm({...form, name:e.target.value})} placeholder="John Doe" />
            <Input label="Email *" type="email" value={form.email} onChange={e => setForm({...form, email:e.target.value})} placeholder="john@company.com" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Company" value={form.company} onChange={e => setForm({...form, company:e.target.value})} placeholder="Acme Corp" />
            <Input label="Phone" value={form.phone} onChange={e => setForm({...form, phone:e.target.value})} placeholder="+91 98765 43210" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Select label="Role" value={form.role} onChange={e => setForm({...form, role:e.target.value})}>
              {['GENERAL','FOUNDER','SALES','HR','CTO','CFO'].map(r => <option key={r}>{r}</option>)}
            </Select>
            <Select label="Pipeline Stage" value={form.pipelineStage} onChange={e => setForm({...form, pipelineStage:e.target.value})}>
              {PIPELINE_STAGES.slice(0,6).map(s => <option key={s}>{s}</option>)}
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Category" value={form.category} onChange={e => setForm({...form, category:e.target.value})} placeholder="SaaS, E-commerce..." />
            <Input label="Tags (comma separated)" value={form.tags} onChange={e => setForm({...form, tags:e.target.value})} placeholder="VIP, Hot..." />
          </div>
          <Textarea label="Notes" value={form.notes} onChange={e => setForm({...form, notes:e.target.value})} placeholder="Any notes..." />
          <div className="flex justify-end gap-2 pt-2">
            <Btn variant="secondary" onClick={() => setAddOpen(false)}>Cancel</Btn>
            <Btn variant="primary" onClick={addLead}><Plus size={14} /> Add Lead</Btn>
          </div>
        </div>
      </Modal>

      {/* Import Modal */}
      <Modal open={importOpen} onClose={() => setImportOpen(false)} title="Import CSV">
        <div className="space-y-4">
          <p className="text-sm text-slate-500">Columns: <code className="bg-slate-100 px-1.5 py-0.5 rounded text-emerald-700 text-xs">Name, Email</code> required. Optional: Company, Phone, Category</p>
          <Textarea label="Paste CSV" value={csvText} onChange={e => setCsvText(e.target.value)} placeholder={"Name,Email\nJohn Doe,john@acme.com"} style={{ minHeight: 160 }} />
          <div className="flex justify-end gap-2">
            <Btn variant="secondary" onClick={() => setImportOpen(false)}>Cancel</Btn>
            <Btn variant="primary" onClick={importCSV}><Upload size={14} /> Import</Btn>
          </div>
        </div>
      </Modal>

      {/* Email Modal */}
      <Modal open={emailOpen} onClose={() => setEmailOpen(false)} title={`Send Email — ${emailLead?.name}`} width="max-w-2xl">
        {emailLead && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
              <div className="w-9 h-9 rounded-full bg-emerald-100 flex items-center justify-center text-sm font-bold text-emerald-700">{(emailLead.name||'?')[0]}</div>
              <div>
                <p className="font-semibold text-slate-900 text-sm">{emailLead.name}</p>
                <p className="text-xs text-slate-500 font-mono">{emailLead.email}</p>
              </div>
              <span className={`badge ml-auto text-xs ${STAGE_COLORS[emailLead.pipelineStage]?.bg} ${STAGE_COLORS[emailLead.pipelineStage]?.text}`}>{emailLead.pipelineStage}</span>
            </div>
            <Input label="Subject" value={emailSubject} onChange={e => setEmailSubject(e.target.value)} placeholder="Quick idea for your company..." />
            <Textarea label="Email Body" value={emailBody} onChange={e => setEmailBody(e.target.value)} placeholder="Write your email or click Generate AI..." style={{ minHeight: 160 }} />
            <div className="flex justify-between items-center pt-2">
              <Btn variant="secondary" onClick={generateEmail} disabled={genLoading}>
                {genLoading ? <><svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg> Generating...</> : '✦ Generate AI'}
              </Btn>
              <div className="flex gap-2">
                <Btn variant="secondary" onClick={() => setEmailOpen(false)}>Cancel</Btn>
                <Btn variant="primary" onClick={sendEmail} disabled={sendLoading}>
                  {sendLoading ? 'Sending...' : '✉ Send Email'}
                </Btn>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
