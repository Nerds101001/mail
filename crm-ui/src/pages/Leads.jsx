import { useState, useEffect } from 'react'
import { useCRM } from '../store'
import { enrichLead, isValidEmail, PIPELINE_STAGES, STAGE_COLORS, STATUS_COLORS, fmtDate } from '../utils'
import { Modal, Btn, Input, Select, Textarea, Badge, Empty, PageHeader, toast } from '../components/ui'
import { Plus, Upload, CheckCircle, Zap, Trash2, UserCheck, Search, Filter, Flame, Users } from 'lucide-react'

export default function Leads() {
  const { leads, setLeads, profiles, settings, logActivity, pushToRedis, saveLeads } = useCRM()
  const [search, setSearch]   = useState('')
  const [stageF, setStageF]   = useState('')
  const [statusF, setStatusF] = useState('')
  const [priF, setPriF]       = useState('')
  const [selected, setSelected] = useState(new Set())
  const [addOpen, setAddOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [editLead, setEditLead] = useState(null)
  const [importOpen, setImportOpen] = useState(false)
  const [emailOpen, setEmailOpen] = useState(false)
  const [emailLead, setEmailLead] = useState(null)
  const [form, setForm] = useState({ name:'', email:'', company:'', phone:'', role:'GENERAL', category:'General', tags:'', notes:'', pipelineStage:'COLD' })
  const [csvText, setCsvText] = useState('')
  const [emailBody, setEmailBody] = useState('')
  const [emailSubject, setEmailSubject] = useState('')
  const [genLoading, setGenLoading] = useState(false)
  const [sendLoading, setSendLoading] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [scores, setScores] = useState({}) // leadId → { score, label }
  const [researchingId, setResearchingId] = useState(null)

  // Auto-load engagement scores on mount
  useEffect(() => {
    if (leads.length > 0) fetchScores(leads)
  }, []) // eslint-disable-line

  const filtered = leads.filter(l => {
    const s = search.toLowerCase()
    return (!s || [l.name||'',l.email||'',l.company||''].join(' ').toLowerCase().includes(s))
      && (!stageF  || l.pipelineStage === stageF)
      && (!statusF || l.status === statusF)
      && (!priF    || l.priority === priF)
  })

  function save(newLeads) { 
    setLeads(newLeads); 
    saveLeads(newLeads); // Use saveLeads to ensure immediate database save with the exact data
  }

  async function fetchScores(leadList) {
    try {
      const ids = leadList.map(l => l.id).join(',')
      const res = await fetch(`/api/ops?type=lead-scores&ids=${ids}`)
      const data = await res.json()
      setScores(prev => ({ ...prev, ...data }))
    } catch { /* silent */ }
  }

  async function addLead() {
    if (!form.name || !form.email) { toast('Name and email required', 'error'); return }
    if (!isValidEmail(form.email)) { toast('Invalid email', 'error'); return }
    if (leads.find(l => l.email.toLowerCase() === form.email.toLowerCase())) { toast('Email already exists', 'error'); return }

    // Auto-verify email via MX DNS check
    let status = 'VALID'
    try {
      const vr = await fetch(`/api/ops?type=verify-email&email=${encodeURIComponent(form.email)}`)
      const vd = await vr.json()
      if (!vd.valid) { status = 'INVALID'; toast(`⚠ Email may be invalid: ${vd.reason}`, 'warn') }
    } catch { /* non-blocking */ }

    const l = enrichLead({ id:'lead_'+Date.now(), ...form, status, email:form.email.toLowerCase(), tags:form.tags.split(',').map(t=>t.trim()).filter(Boolean), opens:0, clicks:0, score:40, lastSent:'', domain:'', priority:'LOW', createdAt:new Date().toISOString() })
    save([...leads, l])
    logActivity(`Added lead: ${form.name} <${form.email}>`)
    toast(`${form.name} added${status === 'INVALID' ? ' (invalid email flagged)' : ''}`, status === 'INVALID' ? 'warn' : 'success')
    setAddOpen(false)
    setForm({ name:'', email:'', company:'', phone:'', role:'GENERAL', category:'General', tags:'', notes:'', pipelineStage:'COLD' })

    // Auto-suggest AI research note if company is provided and API key exists
    if (form.company && settings?.openaiKey && !form.notes) {
      researchLead({ id: l.id, name: form.name, company: form.company, category: form.category, role: form.role }, [...leads, l])
    }
  }

  function openEditLead(lead) {
    setEditLead(lead)
    setForm({
      name: lead.name || '',
      email: lead.email || '',
      company: lead.company || '',
      phone: lead.phone || '',
      role: lead.role || 'GENERAL',
      category: lead.category || 'General',
      tags: (lead.tags || []).join(', '),
      notes: lead.notes || '',
      pipelineStage: lead.pipelineStage || 'COLD'
    })
    setEditOpen(true)
  }

  function updateLead() {
    if (!form.name || !form.email) { toast('Name and email required', 'error'); return }
    if (!isValidEmail(form.email)) { toast('Invalid email', 'error'); return }
    
    // Check if email already exists (excluding current lead)
    const existingLead = leads.find(l => l.email.toLowerCase() === form.email.toLowerCase() && l.id !== editLead.id)
    if (existingLead) { toast('Email already exists', 'error'); return }

    const updatedLead = {
      ...editLead,
      ...form,
      email: form.email.toLowerCase(),
      tags: form.tags.split(',').map(t=>t.trim()).filter(Boolean),
      updatedAt: new Date().toISOString()
    }

    const newLeads = leads.map(l => l.id === editLead.id ? updatedLead : l)
    save(newLeads)
    logActivity(`Updated lead: ${form.name} <${form.email}>`)
    toast(`${form.name} updated`, 'success')
    setEditOpen(false)
    setEditLead(null)
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

  async function importCSV() {
    const lines = csvText.trim().split('\n').map(l => l.trim()).filter(Boolean)
    if (lines.length < 2) { toast('Need header + at least 1 row', 'error'); return }
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase())
    const ni = headers.indexOf('name'), ei = headers.indexOf('email')
    if (ei < 0) { toast('CSV must have Email column', 'error'); return }

    const fresh = []
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map(c => c.trim().replace(/^"|"$/g, ''))
      const email = cols[ei] || ''
      if (!email || !isValidEmail(email)) continue
      if (leads.find(l => l.email.toLowerCase() === email.toLowerCase())) continue
      const ci = headers.indexOf('company'), phi = headers.indexOf('phone')
      const cati = headers.indexOf('category'), tagi = headers.indexOf('tags'), ni2 = headers.indexOf('notes')
      const name     = ni >= 0   ? (cols[ni]   || email.split('@')[0]) : email.split('@')[0]
      const company  = ci >= 0   ? (cols[ci]   || '') : ''
      const phone    = phi >= 0  ? (cols[phi]  || '') : ''
      const category = cati >= 0 ? (cols[cati] || 'General') : 'General'
      const tags     = tagi >= 0 ? cols[tagi].split(';').map(t=>t.trim()).filter(Boolean) : []
      const notes    = ni2 >= 0  ? (cols[ni2]  || '') : ''
      fresh.push(enrichLead({ id:'lead_'+(Date.now()+i), name, email:email.toLowerCase(), company, phone, role:'', category, tags, notes, status:'VALID', pipelineStage:'COLD', stage:'', opens:0, clicks:0, score:40, lastSent:'', domain:'', priority:'LOW', createdAt:new Date().toISOString() }))
    }

    if (!fresh.length) { toast('No new valid leads found', 'warn'); return }

    toast(`Verifying ${fresh.length} emails...`, 'info')

    // Auto bulk-verify all imported emails
    try {
      const vr = await fetch('/api/ops?type=verify-bulk', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ emails: fresh.map(l => l.email) }) })
      const { results } = await vr.json()
      let invalid = 0
      fresh.forEach(l => {
        if (results[l.email] && !results[l.email].valid) { l.status = 'INVALID'; invalid++ }
      })
      const newLeads = [...leads, ...fresh]
      save(newLeads)
      logActivity(`CSV import: ${fresh.length} leads (${invalid} invalid)`)
      toast(`Imported ${fresh.length} leads — ${invalid} flagged invalid`, invalid > 0 ? 'warn' : 'success')
    } catch {
      // If verify fails, still import without verification
      save([...leads, ...fresh])
      toast(`Imported ${fresh.length} leads (verification skipped)`, 'success')
    }

    setImportOpen(false); setCsvText('')
  }

  async function researchLead(lead, currentLeads) {
    if (!settings?.openaiKey) { toast('Set NVIDIA API key in Settings first', 'error'); return }
    setResearchingId(lead.id)
    try {
      const res = await fetch('/api/ops?type=generate-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: settings.openaiKey,
          count: 1,
          name: lead.name,
          company: lead.company || '',
          role: lead.role || 'decision maker',
          category: lead.category || 'Business',
          brief: { product: 'B2B software/ERP solutions', industries: lead.category || '' },
          customPrompt: `Do NOT write a sales email. Instead, write ONLY a 1-2 sentence personalization note (max 40 words) that describes what pain points ${lead.company || 'this company'} likely faces based on their industry (${lead.category || 'general business'}), and what specific angle would make a cold email resonate. Format: plain text, no JSON, no subject line, just the note.`
        })
      })
      const data = await res.json()
      const raw = data.variants?.[0]?.body || data.body || ''
      // Extract just the note — strip any email-like content
      const note = raw.replace(/^(hi|dear|hello).*/im, '').replace(/best,[\s\S]*/i, '').trim().slice(0, 200)
      if (note) {
        const updated = (currentLeads || leads).map(l => l.id === lead.id ? { ...l, notes: note } : l)
        save(updated)
        toast(`AI note added for ${lead.name}`, 'success')
      }
    } catch(e) { toast('Research failed: ' + e.message, 'error') }
    setResearchingId(null)
  }

  async function verifyAllEmails() {
    setVerifying(true)
    try {
      const emails = leads.map(l => l.email)
      const res = await fetch('/api/ops?type=verify-bulk', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ emails }) })
      const { results } = await res.json()
      const newLeads = leads.map(l => {
        const r = results[l.email]
        if (!r) return l
        return { ...l, status: r.valid ? (l.status === 'INVALID' ? 'VALID' : l.status) : 'INVALID' }
      })
      const invalidCount = Object.values(results).filter(r => !r.valid).length
      save(newLeads)
      toast(`Verified ${emails.length} emails — ${invalidCount} invalid`, invalidCount > 0 ? 'warn' : 'success')
    } catch(e) { toast('Verification failed: ' + e.message, 'error') }
    setVerifying(false)
  }

  async function generateEmail() {
    if (!settings.openaiKey) { toast('Set NVIDIA API key in Settings', 'error'); return }
    setGenLoading(true)
    try {
      const res = await fetch('/api/ops?type=generate-ai', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ name:emailLead.name, company:emailLead.company||'their company', role:emailLead.role||'', category:emailLead.category||'', apiKey:settings.openaiKey, notes: emailLead.notes || '' }) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      const v = data.variants?.[0] || data
      setEmailSubject(v.subject); setEmailBody(v.body)
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
        <Btn variant="secondary" size="sm" onClick={verifyAllEmails} disabled={verifying}>{verifying ? 'Verifying...' : <><CheckCircle size={14}/> Re-Verify</>}</Btn>
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
                    {scores[l.id] ? (
                      <span className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full ${
                        scores[l.id].label === 'Hot'     ? 'bg-red-100 text-red-700' :
                        scores[l.id].label === 'Warm'    ? 'bg-amber-100 text-amber-700' :
                        scores[l.id].label === 'Engaged' ? 'bg-blue-100 text-blue-700' :
                                                           'bg-slate-100 text-slate-500'}`}>
                        {scores[l.id].label === 'Hot' ? '🔥' : scores[l.id].label === 'Warm' ? '🌡' : ''} {scores[l.id].score}
                      </span>
                    ) : (
                      <span className="text-slate-400 text-xs">{l.score || 0}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-xs">{l.opens||0}👁 {l.clicks||0}🖱</td>
                  <td className="px-4 py-3 text-slate-400 text-xs">{fmtDate(l.lastSent)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button className="p-1.5 rounded-lg hover:bg-blue-50 text-blue-500 transition-colors" title="Send Email" onClick={() => { setEmailLead(l); setEmailBody(''); setEmailSubject(''); setEmailOpen(true) }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                      </button>
                      <button className="p-1.5 rounded-lg hover:bg-green-50 text-green-500 transition-colors" title="Edit Lead" onClick={() => openEditLead(l)}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="m18.5 2.5 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                      </button>
                      <button
                        className="p-1.5 rounded-lg hover:bg-purple-50 text-purple-400 transition-colors disabled:opacity-40"
                        title={l.notes ? `Notes: ${l.notes.slice(0,80)}...` : 'AI Research — auto-generate personalization note'}
                        disabled={researchingId === l.id}
                        onClick={() => researchLead(l, leads)}
                      >
                        {researchingId === l.id
                          ? <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                          : <span className="text-xs font-bold">{l.notes ? '📝' : '✦'}</span>
                        }
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

      {/* Edit Lead Modal */}
      <Modal open={editOpen} onClose={() => setEditOpen(false)} title={`Edit Lead — ${editLead?.name}`}>
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
            <Btn variant="secondary" onClick={() => setEditOpen(false)}>Cancel</Btn>
            <Btn variant="primary" onClick={updateLead}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="m18.5 2.5 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
              Update Lead
            </Btn>
          </div>
        </div>
      </Modal>

      {/* Import Modal */}
      <Modal open={importOpen} onClose={() => setImportOpen(false)} title="Import CSV">
        <div className="space-y-4">
          <p className="text-sm text-slate-500">Columns: <code className="bg-slate-100 px-1.5 py-0.5 rounded text-emerald-700 text-xs">Name, Email</code> required. Optional: Company, Phone, Category, Tags</p>
          <div className="border-2 border-dashed border-slate-200 rounded-xl p-4 text-center hover:border-emerald-300 transition-colors">
            <Upload size={20} className="mx-auto mb-2 text-slate-400" />
            <p className="text-sm text-slate-500 mb-2">Upload a CSV file</p>
            <input
              type="file"
              accept=".csv,text/csv"
              className="text-xs text-slate-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-emerald-50 file:text-emerald-700 hover:file:bg-emerald-100 cursor-pointer"
              onChange={e => {
                const file = e.target.files[0]
                if (!file) return
                const reader = new FileReader()
                reader.onload = ev => setCsvText(ev.target.result)
                reader.readAsText(file)
              }}
            />
          </div>
          <p className="text-xs text-slate-400 text-center">— or paste CSV below —</p>
          <Textarea label="" value={csvText} onChange={e => setCsvText(e.target.value)} placeholder={"Name,Email,Company,Phone,Category\nJohn Doe,john@acme.com,Acme Corp,,SaaS"} style={{ minHeight: 120 }} />
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
