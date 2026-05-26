import { useState, useEffect } from 'react'
import { useCRM } from '../store'
import { PageHeader, Btn, Modal, Input, Textarea, Empty, toast } from '../components/ui'
import { Plus, Mail, Clock, Trash2, Play, Users, ChevronDown, ChevronUp, Edit2 } from 'lucide-react'

export default function Drip() {
  const { leads, viewAs } = useCRM()
  const [sequences,  setSequences]  = useState([])
  const [loading,    setLoading]    = useState(true)
  const [open,       setOpen]       = useState(false)
  const [editSeq,    setEditSeq]    = useState(null)
  const [expanded,   setExpanded]   = useState(null)
  const [enrollOpen, setEnrollOpen] = useState(null)
  const [saving,     setSaving]     = useState(false)
  const [running,    setRunning]    = useState(false)
  const [selLeads,   setSelLeads]   = useState(new Set())

  const authHeader = () => ({ Authorization: `Bearer ${localStorage.getItem('crm_token') || ''}` })
  const vaParam    = () => viewAs ? `?viewAs=${encodeURIComponent(viewAs)}` : ''

  const EMPTY_STEP = { subject: '', body: '', delayDays: 1, senderName: '', trigger: 'always' }
  const EMPTY_FORM = { name: '', steps: [{ ...EMPTY_STEP, delayDays: 0 }] }
  const [form, setForm] = useState(EMPTY_FORM)

  async function load() {
    setLoading(true)
    try {
      const r = await fetch(`/api/drip-sequences${vaParam()}`, { headers: authHeader() })
      setSequences(await r.json())
    } catch { toast('Failed to load sequences', 'error') }
    setLoading(false)
  }

  useEffect(() => { load() }, [viewAs])

  function openNew() { setEditSeq(null); setForm(EMPTY_FORM); setOpen(true) }
  function openEdit(seq) {
    setEditSeq(seq)
    setForm({ name: seq.name, steps: seq.steps?.length ? seq.steps : [{ ...EMPTY_STEP }] })
    setOpen(true)
  }

  function updateStep(idx, field, value) {
    setForm(f => ({ ...f, steps: f.steps.map((s, i) => i === idx ? { ...s, [field]: value } : s) }))
  }

  async function save() {
    if (!form.name.trim()) { toast('Name required', 'error'); return }
    if (!form.steps.length || !form.steps[0].subject) { toast('At least one step with subject required', 'error'); return }
    setSaving(true)
    try {
      const url    = editSeq ? `/api/drip-sequences?id=${editSeq.id}` : '/api/drip-sequences'
      const method = editSeq ? 'PUT' : 'POST'
      const r = await fetch(url, { method, headers: { ...authHeader(), 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
      const d = await r.json()
      if (!d.ok && !d.sequence) { toast(d.error || 'Save failed', 'error'); return }
      toast(editSeq ? 'Sequence updated' : 'Sequence created', 'success')
      setOpen(false); load()
    } catch { toast('Save failed', 'error') }
    setSaving(false)
  }

  async function deleteSeq(id) {
    if (!confirm('Delete this sequence and all enrollments?')) return
    await fetch(`/api/drip-sequences?id=${id}`, { method: 'DELETE', headers: authHeader() })
    toast('Deleted', 'success'); load()
  }

  async function enroll() {
    if (!selLeads.size) { toast('Select at least one lead', 'error'); return }
    setSaving(true)
    try {
      const enrollLeads = leads.filter(l => selLeads.has(l.id)).map(l => ({ id: l.id, email: l.email, name: l.name }))
      const r = await fetch('/api/drip-enroll', { method: 'POST', headers: { ...authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ sequenceId: enrollOpen.id, leads: enrollLeads }) })
      const d = await r.json()
      toast(`Enrolled ${d.enrolled || 0} leads`, 'success')
      setEnrollOpen(null); setSelLeads(new Set())
    } catch { toast('Enroll failed', 'error') }
    setSaving(false)
  }

  async function runDrip() {
    setRunning(true)
    try {
      const r = await fetch('/api/run-drip', { method: 'POST', headers: authHeader() })
      const d = await r.json()
      toast(`Drip run complete — ${d.sent || 0} emails sent`, 'success')
    } catch { toast('Run failed', 'error') }
    setRunning(false)
  }

  const eligibleLeads = leads.filter(l => l.email && !['UNSUBSCRIBED','WON','LOST'].includes(l.pipelineStage))

  return (
    <div className="space-y-6">
      <PageHeader title="Drip Sequences" subtitle="Automated email sequences triggered by time">
        <Btn variant="secondary" onClick={runDrip} disabled={running}><Play size={14}/>{running ? 'Running…' : 'Run Due Steps'}</Btn>
        <Btn variant="primary" onClick={openNew}><Plus size={14}/> New Sequence</Btn>
      </PageHeader>

      {loading ? (
        <div className="card p-16 text-center text-slate-400">Loading…</div>
      ) : sequences.length === 0 ? (
        <div className="card p-16"><Empty icon={Mail} title="No drip sequences" sub="Create a sequence to automate your follow-ups over time" /></div>
      ) : (
        <div className="space-y-3">
          {sequences.map(seq => (
            <div key={seq.id} className="card overflow-hidden">
              <div className="flex items-center gap-4 px-5 py-4 cursor-pointer hover:bg-slate-50/50 transition-colors"
                onClick={() => setExpanded(expanded === seq.id ? null : seq.id)}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-slate-900">{seq.name}</p>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${seq.active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                      {seq.active ? 'Active' : 'Paused'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">{seq.steps?.length || 0} steps</p>
                </div>
                <div className="flex items-center gap-2">
                  <Btn variant="secondary" size="sm" onClick={e => { e.stopPropagation(); setEnrollOpen(seq); setSelLeads(new Set()) }}>
                    <Users size={12}/> Enroll Leads
                  </Btn>
                  <button onClick={e => { e.stopPropagation(); openEdit(seq) }} className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"><Edit2 size={13}/></button>
                  <button onClick={e => { e.stopPropagation(); deleteSeq(seq.id) }} className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"><Trash2 size={13}/></button>
                  {expanded === seq.id ? <ChevronUp size={16} className="text-slate-400"/> : <ChevronDown size={16} className="text-slate-400"/>}
                </div>
              </div>

              {expanded === seq.id && (
                <div className="border-t border-slate-100 px-5 py-4">
                  <div className="relative">
                    {(seq.steps||[]).map((step, idx) => (
                      <div key={idx} className="flex gap-4 mb-4">
                        <div className="flex flex-col items-center">
                          <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center flex-shrink-0">
                            <Mail size={14} className="text-indigo-600"/>
                          </div>
                          {idx < (seq.steps||[]).length - 1 && <div className="w-px flex-1 bg-indigo-100 mt-1"/>}
                        </div>
                        <div className="flex-1 pb-4">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <span className="text-xs font-bold text-indigo-600">Step {idx + 1}</span>
                            {idx === 0 ? (
                              <span className="text-xs text-slate-400 flex items-center gap-1"><Clock size={10}/> Immediately</span>
                            ) : (
                              <span className="text-xs text-slate-400 flex items-center gap-1"><Clock size={10}/> After {step.delayDays} day{step.delayDays !== 1 ? 's' : ''}</span>
                            )}
                            {idx > 0 && step.trigger && step.trigger !== 'always' && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-violet-100 text-violet-600">
                                {{if_opened:'if opened',if_clicked:'if clicked',if_not_opened:'if not opened'}[step.trigger] || step.trigger}
                              </span>
                            )}
                          </div>
                          <p className="text-sm font-semibold text-slate-800">{step.subject || '(no subject)'}</p>
                          <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{step.body || '(no body)'}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Create / Edit sequence modal */}
      <Modal open={open} onClose={() => setOpen(false)} title={editSeq ? 'Edit Sequence' : 'New Drip Sequence'} width="max-w-2xl">
        <div className="space-y-4">
          <Input label="Sequence Name" value={form.name} onChange={e => setForm(f=>({...f,name:e.target.value}))} placeholder="e.g. Cold Outreach — 3 Touch"/>

          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="text-xs font-semibold text-slate-600">Steps</label>
              <button onClick={() => setForm(f=>({...f,steps:[...f.steps,{...EMPTY_STEP}]}))}
                className="text-xs text-indigo-600 font-semibold hover:underline flex items-center gap-1"><Plus size={11}/>Add step</button>
            </div>
            <div className="space-y-3">
              {form.steps.map((step, idx) => (
                <div key={idx} className="border border-slate-200 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-indigo-600">Step {idx + 1}</span>
                    {form.steps.length > 1 && (
                      <button onClick={() => setForm(f=>({...f,steps:f.steps.filter((_,i)=>i!==idx)}))}
                        className="text-slate-300 hover:text-red-400 transition-colors"><Trash2 size={13}/></button>
                    )}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Input label="Subject" value={step.subject} onChange={e => updateStep(idx,'subject',e.target.value)} placeholder="Email subject line"/>
                    {idx === 0 ? (
                      <div><label className="block text-xs font-semibold text-slate-600 mb-1">Send</label>
                        <div className="border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-500">Immediately on enroll</div></div>
                    ) : (
                      <div><label className="block text-xs font-semibold text-slate-600 mb-1">Delay (days after previous)</label>
                        <input type="number" min="1" value={step.delayDays} onChange={e => updateStep(idx,'delayDays',parseInt(e.target.value)||1)}
                          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"/></div>
                    )}
                  </div>
                  {idx > 0 && (
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">
                        Send condition <span className="text-slate-400 font-normal">(based on lead behaviour)</span>
                      </label>
                      <select
                        value={step.trigger || 'always'}
                        onChange={e => updateStep(idx, 'trigger', e.target.value)}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                      >
                        <option value="always">Always send (time-based only)</option>
                        <option value="if_opened">Only if lead opened a previous email</option>
                        <option value="if_clicked">Only if lead clicked a link</option>
                        <option value="if_not_opened">Only if lead has NOT opened (no engagement)</option>
                      </select>
                    </div>
                  )}
                  <Textarea label="Email Body" value={step.body} onChange={e => updateStep(idx,'body',e.target.value)} rows={3} placeholder="Email body… Use [name], [company] for personalisation"/>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
            <Btn variant="secondary" onClick={() => setOpen(false)}>Cancel</Btn>
            <Btn variant="primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : editSeq ? 'Update' : 'Create Sequence'}</Btn>
          </div>
        </div>
      </Modal>

      {/* Enroll leads modal */}
      <Modal open={!!enrollOpen} onClose={() => setEnrollOpen(null)} title={`Enroll leads — ${enrollOpen?.name}`} width="max-w-lg">
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>{selLeads.size} selected</span>
            <div className="flex gap-2">
              <button className="text-indigo-600 font-semibold hover:underline" onClick={() => setSelLeads(new Set(eligibleLeads.map(l=>l.id)))}>All</button>
              <button className="text-slate-400 hover:underline" onClick={() => setSelLeads(new Set())}>None</button>
            </div>
          </div>
          <div className="max-h-64 overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-100">
            {eligibleLeads.map(l => (
              <label key={l.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 cursor-pointer">
                <input type="checkbox" checked={selLeads.has(l.id)}
                  onChange={e => setSelLeads(prev => { const n = new Set(prev); e.target.checked ? n.add(l.id) : n.delete(l.id); return n })}
                  className="accent-indigo-600"/>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate">{l.name || l.email}</p>
                  <p className="text-xs text-slate-400 truncate">{l.email} · {l.pipelineStage}</p>
                </div>
              </label>
            ))}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Btn variant="secondary" onClick={() => setEnrollOpen(null)}>Cancel</Btn>
            <Btn variant="primary" onClick={enroll} disabled={saving || !selLeads.size}>{saving ? 'Enrolling…' : `Enroll ${selLeads.size} leads`}</Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}
